// API address settings.
// - On your laptop (localhost / 127.0.0.1) the form talks to your local backend.
// - On the internet (Vercel) it talks to your Render backend.
//
// AFTER you deploy the backend on Render, replace PRODUCTION_API_URL below
// with your real Render URL (no trailing slash), then redeploy Vercel.
(function () {
  var LOCAL_API_URL = 'http://localhost:3000';
  var PRODUCTION_API_URL = 'https://complaint-portal-gzgb.onrender.com';

  var isLocal = ['localhost', '127.0.0.1'].indexOf(window.location.hostname) !== -1;
  window.APP_CONFIG = {
    API_BASE_URL: isLocal ? LOCAL_API_URL : PRODUCTION_API_URL,
  };
})();
