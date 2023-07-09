// - user comand window - //
document.getElementById('top-menu-user-btn').addEventListener('click', function() {
    var menu = document.getElementById('top-menu-user');
    menu.classList.toggle('visible');
  });




// Отримання URL-параметра з даними
const urlParams = new URLSearchParams(window.location.search);
const jsonDataParam = urlParams.get('data');
const nameDataParam = urlParams.get('nameData');

// // Перевірка наявності даних у URL-параметрі
// if (jsonDataParam) {
//   // Розпакування JSON-рядка в об'єкт
//   const registrationData = JSON.parse(decodeURIComponent(jsonDataParam));

//   // Отримання значень полів з об'єкта
//   const firstName = registrationData.firstName;
//   const lastName = registrationData.lastName;
//   const phoneNumber = registrationData.phoneNumber;
//   const email = registrationData.email;

//   // Використання отриманих даних
//   // Наприклад, встановлення значень полів на сторінці або виведення їх у консоль
//   console.log(firstName, lastName, email, phoneNumber );
// }

if (jsonDataParam) {
  // Розпакування JSON-рядка в об'єкт
  const registrationData = JSON.parse(decodeURIComponent(jsonDataParam));

  // Отримання значень полів з об'єкта
  const firstName = registrationData.firstName;
  const lastName = registrationData.lastName;

  // Встановлення значень полів на сторінці
  const nameElement = document.getElementById('Name-user');
  nameElement.innerText = `${firstName} ${lastName}`;

  // Зміна стилю на видимий
  const userElement = document.querySelector('.user');
  userElement.style.display = 'block';
}
