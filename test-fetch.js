fetch('https://google.com')
  .then(res => console.log('Fetch success, status:', res.status))
  .catch(err => console.error('Fetch failed:', err));
