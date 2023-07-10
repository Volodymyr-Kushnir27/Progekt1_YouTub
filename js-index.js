// - user comand window - //
document.getElementById('top-menu-user-btn').addEventListener('click', function() {
    var menu = document.getElementById('top-menu-user');
    menu.classList.toggle('visible');
  });




const jsonDataParam = localStorage.getItem('registrationData');


if (jsonDataParam) {
  // Розпакування JSON-рядка в об'єкт
  const registrationData = JSON.parse(jsonDataParam);

  // Отримання значень полів з об'єкта
  const firstName = registrationData.firstName;
  const lastName = registrationData.lastName;
  const fphoneNumber = registrationData.phoneNumber;
  const email = registrationData.email

  // Встановлення значень полів на сторінці
  const nameElement = document.getElementById('Name-user');
  nameElement.innerText = `${firstName} ${lastName}`;



  // Зміна стилю на видимий
  const userElement = document.querySelector('.user');
  userElement.style.display = 'block';
}


if (jsonDataParam) {

  const registrationData = JSON.parse(jsonDataParam);

  const firstName = registrationData.firstName;
  const lastName = registrationData.lastName;
  const fphoneNumber = registrationData.phoneNumber;
  const email = registrationData.email

const nameUser = document.getElementById('name');
nameUser.innerText = `${firstName}`;
const surnameUser = document.getElementById('surname');
surnameUser.innerText = `${lastName}`;
const phoneUser = document.getElementById('phone');
phoneUser.innerText = `${fphoneNumber}`;
const emailsUser = document.getElementById('emails');
emailsUser.innerText = `${email}`; };