function register() {
  // Отримання значень полів форми
  const firstName = document.getElementById('firstName').value;
  const lastName = document.getElementById('lastName').value;
  const phoneNumber = document.getElementById('phoneNumber').value;
  const email = document.getElementById('email').value;

  // Перевірка правильності номеру телефону
  const phoneRegex = /^\d{9}$/;
  if (!phoneRegex.test(phoneNumber)) {
    document.getElementById('nofon').textContent = 'Введіть коректний номер телефону (9 цифр)!';
    document.getElementById('nofon').style.display = 'block';
    return;
  }

  // Перевірка правильності електронної пошти
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    document.getElementById('noemail').textContent = 'Введіть коректну електронну пошту!';
    document.getElementById('noemail').style.display = 'block';
    return;
  }

  // Створення об'єкта з даними реєстрації
  const registrationData = {
    firstName,
    lastName,
    phoneNumber,
    email
  };

  console.log( registrationData) ;
  // Перетворення об'єкту у JSON-рядок
  const jsonData = JSON.stringify(registrationData);

  // Перехід на іншу сторінку з передачею даних через URL-параметр
  if (phoneNumber && email) {
    window.location.href = `https://volodymyr-kushnir27.github.io/Progekt1_YouTub/=${encodeURIComponent(jsonData)}`;
  }
}

// Обмеження введення символів в поле номеру телефону
const phoneNumberInput = document.getElementById('phoneNumber');
phoneNumberInput.addEventListener('input', function(event) {
  const input = event.target.value;
  event.target.value = input.replace(/\D/g, '').slice(0, 9);
});






