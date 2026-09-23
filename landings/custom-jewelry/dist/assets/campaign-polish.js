(function(){
  "use strict";
  document.querySelectorAll(".final-cta__form").forEach(function(form){
    form.addEventListener("submit",function(event){
      event.preventDefault();
      if(!form.reportValidity()) return;
      var data=new FormData(form);
      window.KolvikaLead.submit({
        type:form.dataset.leadType||"Финальная заявка",
        name:String(data.get("name")||"").trim(),
        phone:String(data.get("phone")||"").trim(),
        message:"Заявка из заключительного блока сайта"
      });
      form.reset();
      var button=form.querySelector('button[type="submit"]');
      button.textContent="Заявка отправлена";
      button.disabled=true;
    });
  });
})();
