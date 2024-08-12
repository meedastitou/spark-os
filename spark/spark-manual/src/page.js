import './bootstrap.less';
import './style.css';

const context = require.context('./doc', true, /\.md$/);
const obj = {};
context.keys().forEach((key) => {
  const keyNormalized = key.replace(/^\.\//, '');
  obj[keyNormalized] = context(key);
});

document.addEventListener('DOMContentLoaded', () => {
  Object.keys(obj).forEach((key) => {
    const div = document.getElementById(key);
    if (div) {
      div.innerHTML = obj[key];
    }
  });
});
