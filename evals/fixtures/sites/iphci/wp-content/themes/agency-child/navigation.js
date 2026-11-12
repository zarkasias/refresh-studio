(function () {
  document.addEventListener('click', function (event) {
    var link = event.target.closest('.has-submenu > a[href="#"]');
    if (!link) return;
    event.preventDefault();
    var item = link.parentElement;
    var open = item.classList.toggle('open');
    link.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
})();
