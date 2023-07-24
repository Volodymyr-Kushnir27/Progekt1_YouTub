const  headerTemplat = `

<!-- //* ШАПКА ПРОФІЛЮ *// -->
<header class="site-header">
  <div class="log" id="log1">
    <a href="https://www.youtube.com/">
      <img src="photo/yuo1.png" alt="Головна сторінка" />
    </a>
    <a href="https://www.youtube.com/">
      <h3>YouTube</h3>
    </a>
  </div>

  <div class="search-bar">
    <input type="text" placeholder="Пошук" />
    <button type="submit">Знайти</button>
  </div>

  <div class="site-user">
    <div id="user-btn-block">
      <div id="top-menu-user-btn" class="top-menu__btn display-flex">
        <img
          id="fot-usr"
          src="photo/user.png"
          alt="Кнопка"
          class="top-menu__button-image"
        />
      </div>
      <div class="top-menu__list hidden" id="top-menu-user">
        <div id="Name-user" class="user">
          <h3></h3>
        </div>
        <div class="top-menu__list-item reestr" id="Reestr">
          <a href="reest.html">
            <button>
              <span> Реєстрація на сайті </span>
            </button>
          </a>
        </div>
        <div class="top-menu__list-item top-menu__logout">
          <button>
            <span> Налаштування облікового запису </span>
          </button>
        </div>
        <div class="top-menu__list-item top-menu__logout delet">
          <button id="button-cleener">
            <span> Вийти з облікового запису </span>
          </button>
        </div>
        </div>
      </div>
    </div>
  </div>
</header>

<!-- /* SID-BAR */ -->

<div class="content_container">
  <div class="sid_grid">
    <div class="sidebar">
      <a href="index.html">
        <button class="image-button">
          <img src="photo/home.jpeg" alt="Головна сторінка" />
          <span>Головна сторінка</span>
        </button>
      </a>
    </div>

    <div class="sidebar">
      <a href="https://www.youtube.com/shorts/sYXrDfCCgSQ">
        <button class="image-button">
          <img src="photo/short.png" alt="YouTube Shorts" />
          <span> YouTube Shorts </span>
        </button>
      </a>
    </div>

    <div class="sidebar">
      <a href="https://www.youtube.com/feed/subscriptions">
        <button class="image-button">
          <img src="photo/subscribe.png" alt="Підписки" />
          <span>Підписки</span>
        </button>
      </a>
    </div>

    <div class="sidebar">
      <a href="seting.html">
        <button class="image-button">
          <img src="photo/yuo.png" alt="Original" />
          <span> Історія переглядів  </span>
        </button>
      </a>
    </div>
  </div>
</div> `

export default headerTemplat ;
