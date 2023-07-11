
// - user comand window - //
document.getElementById('top-menu-user-btn').addEventListener('click', function() {
  var menu = document.getElementById('top-menu-user');
  menu.classList.toggle('visible');
});
//-----Cleen storage ---//
document.getElementById("button-cleener").addEventListener("click", function() {
  // Очищення локального сховища
  localStorage.clear();
  
  // Оновлення сторінки
  location.reload();
});



const jsonDataParam = localStorage.getItem('registrationData');

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

//---- New setting ----//

// Отримати елементи з DOM
const nameUser = document.getElementById('name');
const surnameUser = document.getElementById('surname');
const phoneUser = document.getElementById('phone');
const emailsUser = document.getElementById('emails');
const settingButton = document.getElementById('setting-button');

// Функція, яка змінює відображення на сторінці
function updateDisplay(registrationData, staticFields) {
  if (staticFields) {
    nameUser.innerHTML = `<span id="name-span">${registrationData.firstName}</span>`;
    surnameUser.innerHTML = `<span id="surname-span">${registrationData.lastName}</span>`;
    phoneUser.innerHTML = `<span id="phone-span">${registrationData.phoneNumber}</span>`;
    emailsUser.innerHTML = `<span id="emails-span">${registrationData.email}</span>`;
  } else {
    nameUser.innerHTML = `<input type="text" id="name-input" value="${registrationData.firstName}">`;
    surnameUser.innerHTML = `<input type="text" id="surname-input" value="${registrationData.lastName}">`;
    phoneUser.innerHTML = `<input type="text" id="phone-input" value="${registrationData.phoneNumber}">`;
    emailsUser.innerHTML = `<input type="text" id="emails-input" value="${registrationData.email}">`;
  }
}

// Функція, яка зберігає зміни в localStorage
function saveChanges() {
  const firstNameInput = document.getElementById('name-input').value;
  const lastNameInput = document.getElementById('surname-input').value;
  const phoneNumberInput = document.getElementById('phone-input').value;
  const emailInput = document.getElementById('emails-input').value;

  const updatedData = {
    firstName: firstNameInput,
    lastName: lastNameInput,
    phoneNumber: phoneNumberInput,
    email: emailInput
  };

  // Перевірка формату електронної пошти
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (emailInput !== '' && !regex.test(emailInput)) {
    emailsUser.classList.add('invalid-email');
    return;
  }

  localStorage.setItem('registrationData', JSON.stringify(updatedData));

  // Оновити відображення на сторінці
  updateData();
}

// Функція, яка оновлює відображення даних
function updateData() {
  const jsonDataParam = localStorage.getItem('registrationData');
  if (jsonDataParam) {
    const registrationData = JSON.parse(jsonDataParam);
    updateDisplay(registrationData, false);
  }
}

// Змінна, що відстежує стан відображення полів
let fieldsVisible = false;

// Обробка кліку на кнопку
settingButton.addEventListener('click', function() {
  if (fieldsVisible) {
    // Закриття полів та збереження змін
    saveChanges();
    fieldsVisible = false;
    settingButton.innerText = 'Змінити дані';
  } else {
    // Відкриття полів
    updateData();
    fieldsVisible = true;
    settingButton.innerText = 'Зберегти зміни';
  }
});

// Перевірка формату номеру телефону
phoneUser.addEventListener('input', function(e) {
  const input = e.target.value;
  e.target.value = input.replace(/\D/g, '').slice(0, 10);
});

// Перевірка формату електронної пошти
emailsUser.addEventListener('input', function(e) {
  const input = e.target.value;
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!regex.test(input)) {
    e.target.classList.add('invalid-email');
  } else {
    e.target.classList.remove('invalid-email');
  }
});












        // -------- Foto --------   //
// Отримуємо посилання на елементи DOM
const imageContainer = document.getElementById("imag-user");
const userPhoto = document.getElementById("user-photo");
const uploadButton = document.getElementById("upload-btn");
const fotUser = document.getElementById("fot-usr");

// Завантаження фотографії
function uploadPhoto() {
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.addEventListener("change", function(event) {
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = function(e) {
      const imageData = e.target.result;
      // Зберігання фотографії у локальному сховищі
      localStorage.setItem("userPhoto", imageData);
      // Оновлення зображення у контейнерах
      updateImage(imageData);
    };
    reader.readAsDataURL(file);
  });
  fileInput.click();
}

// Оновлення зображення у контейнерах
function updateImage(imageData) {
  const maxWidth = imageContainer.offsetWidth;
  const maxHeight = imageContainer.offsetHeight;

  const image = new Image();
  image.src = imageData;

  image.onload = function() {
    const width = image.width;
    const height = image.height;

    let newWidth = width;
    let newHeight = height;

    // Перевірка, чи потрібно зменшувати розміри зображення
    if (width > maxWidth || height > maxHeight) {
      const widthRatio = maxWidth / width;
      const heightRatio = maxHeight / height;

      // Вибираємо найменший коефіцієнт зменшення
      const scaleFactor = Math.min(widthRatio, heightRatio);

      
    }

    // Застосовуємо нові розміри до зображень
    userPhoto.style.width = `100%`;
    userPhoto.style.height = `100%`;
    userPhoto.src = imageData;

    fotUser.style.width = "100%";
    fotUser.style.height = "100%";
    fotUser.src = imageData;
  };
}

// Перевірка, чи існує збережена фотографія в локальному сховищі
if (localStorage.getItem("userPhoto")) {
  const savedImageData = localStorage.getItem("userPhoto");
  updateImage(savedImageData);
}

// Додати обробник події на кнопку завантаження
uploadButton.addEventListener("click", uploadPhoto);
  

