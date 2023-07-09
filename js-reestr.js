// - user comand window - //
document.getElementById('top-menu-user-btn').addEventListener('click', function() {
    var menu = document.getElementById('top-menu-user');
    menu.classList.toggle('visible');
  });


  // Створення нового елементу для відображення даних клієнта
  const clientDataElement = document.createElement('div');
  clientDataElement.innerHTML = `
    <p>Ім'я: ${klient.newKlient.firstName}</p>
    <p>Прізвище: ${klient.newKlient.lastName}</p>
    <p>Номер телефону: ${klient.newKlient.phoneNumber}</p>
    <p>Email: ${klient.newKlient.email}</p>
  `;

  // Додавання елементу з даними клієнта до DOM-дерева сторінки
  const clientDataContainer = document.getElementById('clientDataContainer');
  clientDataContainer.appendChild(clientDataElement);

  console.log(clientDataElement) ;
       
  console.log(clientDataElement) ;
 

