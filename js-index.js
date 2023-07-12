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
console.log(jsonDataParam)

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
  const userReestr = document.querySelector('.reestr')
  userReestr.style.display = 'none' ;
}

// Отримуємо посилання на елементи DOM

const fotUser = document.getElementById("fot-usr");

// Оновлення зображення у контейнерах
function updateImage(imageData) {
  const image = new Image();
  image.src = imageData;

  image.onload = function() {
    const width = image.width;
    const height = image.height;

    let newWidth = width;
    let newHeight = height;  
    }
    fotUser.style.width = "100%";
    fotUser.style.height = "100%";
    fotUser.src = imageData;
  };


// Перевірка, чи існує збережена фотографія в локальному сховищі
if (localStorage.getItem("userPhoto")) {
  const savedImageData = localStorage.getItem("userPhoto");
  updateImage(savedImageData);
  
}


