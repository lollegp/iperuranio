const questions = [...document.querySelectorAll('[data-question]')];

function showQuestion() {
  const selected = questions.find(link => link.hash === window.location.hash) || questions[0];
  for (const link of questions) {
    const record = document.getElementById(link.dataset.question);
    record.hidden = link !== selected;
    if (link === selected) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }
}

for (const link of questions) {
  link.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey ||
      event.metaKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    if (link.hash !== window.location.hash) history.pushState(null, '', link.hash);
    showQuestion();
    document.getElementById(link.dataset.question).focus({preventScroll: true});
  });
}

showQuestion();
window.addEventListener('hashchange', showQuestion);

const copyButton = document.querySelector('[data-copy]');
const command = document.getElementById('install-cmd');
const status = document.querySelector('.copy-status');

if (copyButton && command && status) {
  copyButton.hidden = false;
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(command.textContent);
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(command);
      selection.removeAllRanges();
      selection.addRange(range);
      let copied = false;
      try {
        copied = document.execCommand('copy');
      } catch {
        // The command stays selected for manual copying.
      }
      if (!copied) {
        status.textContent = 'Command selected. Use your copy shortcut.';
        return;
      }
      selection.removeAllRanges();
    }
    status.textContent = 'Copied!';
  });
}
