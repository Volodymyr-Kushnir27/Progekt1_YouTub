
const klient = {};

// Функція для перевірки введеного номера телефону
function validatePhoneNumber(phone) {
  phone.value = phone.value.replace(/\D/g, '');
  phone.value = phone.value.slice(0, 9);  
}

// Функція для обробки події натиснення кнопки "Зареєструватися"
function register() {
  const firstName = document.getElementById('firstName').value;
  const lastName = document.getElementById('lastName').value;
  let phoneNumber = document.getElementById('phoneNumber').value;
  let emailString = document.getElementById('email').value;

  const phoneNumberInput = document.getElementById('phoneNumber');
  phoneNumberInput.addEventListener('input', function() {
    validatePhoneNumber(phoneNumberInput);
    if (!/^\d{9}$/.test(phoneNumberInput.value)) {
      nofon.textContent = 'Не правильний формат вводу';
      nofon.style.display = 'block';
    } else {
      nofon.style.display = 'none';
    }
  });

  validatePhoneNumber(phoneNumberInput);
  phoneNumber = '+380' + phoneNumber;

  if (!/^\d{9}$/.test(phoneNumberInput.value)) {
    // Неправильний формат вводу номера телефону
    nofon.textContent = 'Не правильний формат вводу';
    nofon.style.display = 'block';
    phoneNumberInput.value = phoneNumberInput.value.replace(/\D/g, '');
    return; // Зупинка виконання функції, якщо номер телефону неправильний
  } else {
    nofon.style.display = 'none';
  }

  // Перевірка email
  function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  const emailInput = document.getElementById('email');
  if (!validateEmail(emailString)) {
    // Неправильний формат вводу email
    noemail.textContent = 'Неправильний формат вводу email';
    noemail.style.display = 'block';
    emailInput.value = '';
    return; // Зупинка виконання функції, якщо email неправильний
  } else {
    noemail.style.display = 'none';
  }

  // Створення об'єкта з введеними даними
  const newKlient = {
    firstName: firstName,
    lastName: lastName,
    phoneNumber: phoneNumber,
    email: emailString
  };

  // Додавання об'єкта до об'єкта klient
  klient.newKlient = newKlient;

  // Виведення інформації про реєстрацію в консоль
  console.log('Зареєстрований клієнт:', newKlient);

  // Очищення полів форми
  document.getElementById('firstName').value = '';
  document.getElementById('lastName').value = '';
  document.getElementById('phoneNumber').value = '';
  document.getElementById('email').value = '';
}

// Прив'язка обробника події до введення номера телефону
const phoneNumberInput = document.getElementById('phoneNumber');
phoneNumberInput.addEventListener('input', function() {
  validatePhoneNumber(phoneNumberInput);


  fetch('https://volodymyr-kushnir27.github.io/Progekt1_YouTub/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(klient)
  })
    .then(response => response.json())
    .then(data => {
      // Обробка відповіді від сервера
      console.log('Відповідь сервера:', data);
    })
    .catch(error => {
      // Обробка помилки
      console.error('Сталася помилка:', error);
    });

    window.location.href = "https://volodymyr-kushnir27.github.io/Progekt1_YouTub/";


});


  
