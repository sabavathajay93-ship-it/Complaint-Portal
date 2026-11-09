(function () {
  var form = document.getElementById('complaint-form');
  var button = document.getElementById('submit-btn');
  var message = document.getElementById('message');
  var details = form.elements.details;
  var counter = document.getElementById('char-count');

  details.addEventListener('input', function () {
    counter.textContent = details.value.length;
  });

  function show(text, type) {
    message.textContent = text;
    message.className = 'message ' + (type || '');
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    var payload = {};
    ['studentName', 'institutionType', 'institutionName', 'className', 'section', 'rollNumber', 'phone', 'details']
      .forEach(function (name) {
        payload[name] = form.elements[name].value;
      });

    button.disabled = true;
    button.textContent = 'Submitting...';
    show('Sending your complaint. If the server was asleep this can take up to a minute.', 'info');

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 90000);

    try {
      var response = await fetch(window.APP_CONFIG.API_BASE_URL + '/api/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      var data = await response.json().catch(function () { return {}; });

      if (!response.ok) {
        show(data.error || 'Could not submit the complaint. Please try again.', 'error');
        return;
      }

      form.reset();
      counter.textContent = '0';
      show('Thank you. Your complaint was submitted (reference no. ' + data.id + ').', 'success');
    } catch (err) {
      show('Could not reach the server. Check your internet connection and try again.', 'error');
    } finally {
      clearTimeout(timer);
      button.disabled = false;
      button.textContent = 'Submit complaint';
    }
  });
})();
