"""Receiver regression tests. No network, real contacts, SQLite or CRM writes."""

import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "kolvika_receiver", ROOT / "integrations/server/lead_service.py"
)
receiver = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(receiver)


class ClientIdFieldTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "AMOCRM_ACCOUNT_URL": "https://kolvika.amocrm.ru",
            "AMOCRM_PIPELINE_ID": "11318130",
            "AMOCRM_STATUS_ID": "88725474",
        }, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        for name in ("urlopen", "connect_db"):
            blocked = patch.object(receiver, name, side_effect=AssertionError("External IO blocked"))
            blocked.start()
            self.addCleanup(blocked.stop)
        self.lead = receiver.normalize_lead({
            "request_id": "11111111-2222-4333-8444-555555555555",
            "name": "SYNTHETIC LOCAL TEST",
            "phone": "+70000000000",
            "type": "LOCAL TEST",
            "landing": "custom",
            "ym_client_id": "1234567890123456789",
            "utm": {"utm_source": "codex_qa", "utm_campaign": "local_test"},
        })

    def fields(self):
        return {f["field_id"]: f["values"][0]["value"]
                for f in receiver.configured_lead_fields(self.lead)}

    def test_missing_mapping_delivers_client_id(self):
        self.assertEqual(self.fields(), {2839145: "1234567890123456789"})

    def test_utm_mapping_preserved_alongside_default_client_id(self):
        os.environ["AMOCRM_LEAD_FIELD_IDS_JSON"] = json.dumps({
            "utm_source": 2839123, "utm_campaign": 2839121,
        })
        self.assertEqual(self.fields(), {
            2839145: "1234567890123456789", 2839123: "codex_qa", 2839121: "local_test",
        })

    def test_explicit_client_id_mapping_keeps_priority(self):
        os.environ["AMOCRM_LEAD_FIELD_IDS_JSON"] = '{"ym_client_id":123}'
        self.assertEqual(self.fields(), {123: "1234567890123456789"})

    def test_default_never_leaks_to_other_accounts(self):
        for account in ("https://example.amocrm.ru", "https://example.kommo.com", ""):
            with self.subTest(account=account):
                os.environ["AMOCRM_ACCOUNT_URL"] = account
                self.assertEqual(self.fields(), {})

    def test_missing_client_id_does_not_add_empty_field(self):
        self.lead["ym_client_id"] = ""
        os.environ["AMOCRM_LEAD_FIELD_IDS_JSON"] = '{"utm_source":2839123}'
        self.assertEqual(self.fields(), {2839123: "codex_qa"})

    def test_invalid_configuration_is_not_silently_replaced(self):
        for config in ("not json", "[]", '{"ym_client_id":"invalid"}'):
            with self.subTest(config=config):
                os.environ["AMOCRM_LEAD_FIELD_IDS_JSON"] = config
                with self.assertRaises(receiver.AmoCRMError):
                    self.fields()

    def test_actual_create_request_contains_client_id_utm_and_original_routing(self):
        os.environ["AMOCRM_LEAD_FIELD_IDS_JSON"] = '{"utm_source":2839123}'
        with patch.object(receiver, "find_existing_contact_id", return_value=999), \
             patch.object(receiver, "api_request", return_value=[{"id": 1234}]) as request:
            self.assertEqual(receiver.create_amo_lead(self.lead), 1234)
        method, endpoint, payload = request.call_args.args
        self.assertEqual((method, endpoint), ("POST", "/api/v4/leads/complex"))
        self.assertEqual(len(payload), 1)
        deal = payload[0]
        fields = {f["field_id"]: f["values"][0]["value"] for f in deal["custom_fields_values"]}
        self.assertEqual(fields, {2839145: "1234567890123456789", 2839123: "codex_qa"})
        self.assertEqual((deal["pipeline_id"], deal["status_id"]), (11318130, 88725474))
        self.assertEqual(deal["request_id"], self.lead["request_id"])
        self.assertEqual(deal["_embedded"]["contacts"], [{"id": 999, "is_main": True}])
        request.assert_called_once()

    def test_client_id_still_retained_in_note(self):
        self.assertIn("1234567890123456789", receiver.lead_note(self.lead))


if __name__ == "__main__":
    unittest.main()
