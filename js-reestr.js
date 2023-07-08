// - user comand window - //
document.getElementById('top-menu-user-btn').addEventListener('click', function() {
    var menu = document.getElementById('top-menu-user');
    menu.classList.toggle('visible');
  });




  const urlParams = new URLSearchParams(window.location.search);
   const firstName = urlParams.get('firstName');
   const lastName = urlParams.get('lastName');
   const klien = {
     firstName: firstName,
     lastName: lastName
   }
       
 

