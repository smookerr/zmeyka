/* =========================================================
   Точка входа: связываем платформу, игру и интерфейс.
   ========================================================= */

(function () {
  'use strict';

  const { Loop, Input, Swipe, Stage, Sfx } = window.Platform;
  const { Game } = window.Snake;

  const byId = (id) => document.getElementById(id);

  const canvas = byId('game');
  const overlay = byId('overlay');
  const overlayBadge = byId('overlay-badge');
  const overlayTitle = byId('overlay-title');
  const overlayText = byId('overlay-text');
  const overlayHint = byId('overlay-hint');
  const overlayBtn = byId('overlay-btn');
  const scoreEl = byId('score');
  const bestEl = byId('best');
  const soundBtn = byId('sound-btn');
  const pauseBtn = byId('pause-btn');
  const restartBtn = byId('restart-btn');

  const stage = new Stage(canvas);
  const sfx = new Sfx();
  const input = new Input(window);
  const swipe = new Swipe(canvas);

  const game = new Game({
    stage,
    sfx,
    onScore(score) {
      scoreEl.textContent = String(score);
      bestEl.textContent = String(Math.max(game.best, score));
    },
    onState(state) {
      syncUi(state);
    },
  });

  stage.onResize = () => game.resize();

  /* --------------------------- Интерфейс --------------------------- */

  let overlayState = 'idle';

  function syncUi(state) {
    overlayState = state;
    document.body.dataset.state = state;

    const playing = state === 'playing';
    overlay.classList.toggle('is-visible', !playing);
    overlay.setAttribute('aria-hidden', String(playing));

    scoreEl.textContent = String(game.score);
    bestEl.textContent = String(Math.max(game.best, game.score));

    pauseBtn.textContent = state === 'paused' ? 'Продолжить' : 'Пауза';
    pauseBtn.disabled = !(state === 'playing' || state === 'paused');

    if (state === 'paused') {
      overlayBadge.textContent = 'Пауза';
      overlayTitle.textContent = 'Пауза';
      overlayText.textContent = 'Отдохните — змейка подождёт.';
      overlayBtn.textContent = 'Продолжить';
      overlayHint.innerHTML = '<kbd>Пробел</kbd> — продолжить';
    } else if (state === 'over') {
      overlayBadge.textContent = 'Результат';
      overlayTitle.textContent = 'Игра окончена';
      overlayText.textContent = `Счёт: ${game.score} · Рекорд: ${game.best}`;
      overlayBtn.textContent = 'Ещё раз';
      overlayHint.innerHTML = '<kbd>Enter</kbd> — новая игра';
    } else if (state === 'won') {
      overlayBadge.textContent = 'Победа';
      overlayTitle.textContent = 'Поле заполнено';
      overlayText.textContent = `Вы заняли все клетки. Счёт: ${game.score}`;
      overlayBtn.textContent = 'Ещё раз';
      overlayHint.innerHTML = '<kbd>Enter</kbd> — новая игра';
    } else {
      overlayBadge.textContent = 'Аркада';
      overlayTitle.textContent = 'Змейка';
      overlayText.textContent = 'Собирайте сферы, растите и не врезайтесь в стены и в себя.';
      overlayBtn.textContent = 'Играть';
      overlayHint.innerHTML =
        '<kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> или <kbd>WASD</kbd> · ' +
        '<kbd>Пробел</kbd> — пауза';
    }
  }

  function primaryAction() {
    if (overlayState === 'paused') game.resume();
    else if (overlayState !== 'playing') game.start();
  }

  function toggleSound() {
    const enabled = sfx.toggle();
    soundBtn.textContent = enabled ? 'Звук: вкл' : 'Звук: выкл';
    soundBtn.setAttribute('aria-pressed', String(enabled));
  }

  soundBtn.textContent = sfx.enabled ? 'Звук: вкл' : 'Звук: выкл';
  soundBtn.setAttribute('aria-pressed', String(sfx.enabled));
  syncUi('idle');

  /* ---------------------------- События ---------------------------- */

  overlayBtn.addEventListener('click', primaryAction);

  pauseBtn.addEventListener('click', () => {
    if (game.state === 'playing' || game.state === 'paused') game.togglePause();
    else game.start();
  });

  restartBtn.addEventListener('click', () => game.start());

  soundBtn.addEventListener('click', toggleSound);

  input.on('up', () => game.steer(0, -1));
  input.on('down', () => game.steer(0, 1));
  input.on('left', () => game.steer(-1, 0));
  input.on('right', () => game.steer(1, 0));

  input.on('pause', () => {
    if (game.state === 'idle' || game.state === 'over' || game.state === 'won') game.start();
    else game.togglePause();
  });

  input.on('confirm', primaryAction);
  input.on('restart', () => game.start());
  input.on('mute', toggleSound);

  swipe.onDirection((dx, dy) => game.steer(dx, dy));

  // Не даём игре «убежать», пока вкладка неактивна.
  window.addEventListener('blur', () => game.pause());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.pause();
  });

  /* ----------------------------- Запуск ----------------------------- */

  const loop = new Loop({
    update(dt) {
      game.update(dt);
    },
    render() {
      game.render();
    },
  });

  loop.start();
})();
