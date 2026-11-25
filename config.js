// адрес бэкенда подтягивается из публичного Gist без пересборки сайта
window.NEUROHUB_API = localStorage.getItem("nh_api") || "";
window.NEUROHUB_ENDPOINT_JSON = "https://api.github.com/gists/fb9008e7136d103ebdb74e6bcc8487ed";
window.NEUROHUB_ENDPOINT_FALLBACK = "https://gist.githubusercontent.com/lusty1337/fb9008e7136d103ebdb74e6bcc8487ed/raw/klodeg-endpoint.json";
