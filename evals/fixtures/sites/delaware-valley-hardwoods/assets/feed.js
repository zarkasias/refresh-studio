(function () {
  var feed = document.getElementById("instagram-feed");
  if (!feed) return;
  setTimeout(function () {
    feed.innerHTML = "<figure><img src=\"/assets/feed/post-1.svg\" alt=\"Recent project photo 1\" width=\"96\" height=\"96\"><figcaption>Project photo 1</figcaption></figure><figure><img src=\"/assets/feed/post-2.svg\" alt=\"Recent project photo 2\" width=\"96\" height=\"96\"><figcaption>Project photo 2</figcaption></figure><figure><img src=\"/assets/feed/post-3.svg\" alt=\"Recent project photo 3\" width=\"96\" height=\"96\"><figcaption>Project photo 3</figcaption></figure><figure><img src=\"/assets/feed/post-4.svg\" alt=\"Recent project photo 4\" width=\"96\" height=\"96\"><figcaption>Project photo 4</figcaption></figure><figure><img src=\"/assets/feed/post-5.svg\" alt=\"Recent project photo 5\" width=\"96\" height=\"96\"><figcaption>Project photo 5</figcaption></figure><figure><img src=\"/assets/feed/post-6.svg\" alt=\"Recent project photo 6\" width=\"96\" height=\"96\"><figcaption>Project photo 6</figcaption></figure>";
    feed.setAttribute('data-loaded', 'true');
  }, 1200);
})();
