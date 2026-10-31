/* =========================================================
   Platform — базовый слой, на котором стоит игра.
   Здесь нет ничего про змейку: только цикл, ввод, звук,
   канвас, хранилище и пара утилит.
   ========================================================= */

(function (global) {
  'use strict';

  const TAU = Math.PI * 2;

  const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const randomInt = (max) => Math.floor(Math.random() * max);

  /* --------------------------- Утилиты --------------------------- */

  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  /* -------------------------- Хранилище -------------------------- */

  const Storage = {
    prefix: 'snake.v1.',

    get(key, fallback) {
      try {
        const raw = global.localStorage.getItem(this.prefix + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (error) {
        return fallback;
      }
    },

    set(key, value) {
      try {
        global.localStorage.setItem(this.prefix + key, JSON.stringify(value));
      } catch (error) {
        /* приватный режим или переполнение — играем без сохранения */
      }
    },
  };

  /* ---------------------------- Цикл ----------------------------- */

  class Loop {
    constructor({ update, render, step = 1000 / 60, maxDelta = 250 }) {
      this.update = update;
      this.render = render;
      this.step = step;
      this.maxDelta = maxDelta;
      this.acc = 0;
      this.last = 0;
      this.raf = 0;
      this.running = false;
      this._frame = this._frame.bind(this);
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.acc = 0;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this._frame);
    }

    stop() {
      if (!this.running) return;
      this.running = false;
      cancelAnimationFrame(this.raf);
    }

    _frame(now) {
      this.raf = requestAnimationFrame(this._frame);

      let delta = now - this.last;
      this.last = now;
      if (delta < 0) delta = 0;
      if (delta > this.maxDelta) delta = this.maxDelta;

      this.acc += delta;
      if (this.acc > this.step * 10) this.acc = this.step * 10;

      while (this.acc >= this.step) {
        this.acc -= this.step;
        this.update(this.step / 1000);
      }

      this.render(now / 1000);
    }
  }

  /* ---------------------------- Ввод ----------------------------- */

  const KEY_ACTIONS = {
    ArrowUp: 'up',
    KeyW: 'up',
    Numpad8: 'up',
    ArrowDown: 'down',
    KeyS: 'down',
    Numpad2: 'down',
    ArrowLeft: 'left',
    KeyA: 'left',
    Numpad4: 'left',
    ArrowRight: 'right',
    KeyD: 'right',
    Numpad6: 'right',
    Space: 'pause',
    Escape: 'pause',
    KeyP: 'pause',
    Enter: 'confirm',
    NumpadEnter: 'confirm',
    KeyR: 'restart',
    KeyM: 'mute',
  };

  class Input {
    constructor(target = global) {
      this._listeners = new Map();

      this._onKeyDown = (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const action = KEY_ACTIONS[event.code];
        if (!action) return;
        event.preventDefault();
        if (event.repeat) return;
        this.emit(action);
      };

      target.addEventListener('keydown', this._onKeyDown, { passive: false });
      this.target = target;
    }

    on(action, handler) {
      if (!this._listeners.has(action)) this._listeners.set(action, new Set());
      this._listeners.get(action).add(handler);
      return () => {
        const handlers = this._listeners.get(action);
        if (handlers) handlers.delete(handler);
      };
    }

    emit(action) {
      const handlers = this._listeners.get(action);
      if (!handlers) return;
      for (const handler of handlers) handler();
    }

    destroy() {
      this.target.removeEventListener('keydown', this._onKeyDown);
      this._listeners.clear();
    }
  }

  /** Свайпы для тач-экранов. */
  class Swipe {
    constructor(element, { threshold = 26 } = {}) {
      this.element = element;
      this.threshold = threshold;
      this.listener = null;
      this.start = null;

      this._onDown = (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        this.start = { x: event.clientX, y: event.clientY };
        if (element.setPointerCapture) {
          try {
            element.setPointerCapture(event.pointerId);
          } catch (error) {
            /* не поддерживается — не страшно */
          }
        }
      };

      this._onUp = (event) => {
        if (!this.start) return;
        const dx = event.clientX - this.start.x;
        const dy = event.clientY - this.start.y;
        this.start = null;
        if (Math.abs(dx) < this.threshold && Math.abs(dy) < this.threshold) return;
        if (Math.abs(dx) > Math.abs(dy)) this._emit(dx > 0 ? 1 : -1, 0);
        else this._emit(0, dy > 0 ? 1 : -1);
      };

      this._onCancel = () => {
        this.start = null;
      };

      element.addEventListener('pointerdown', this._onDown);
      element.addEventListener('pointerup', this._onUp);
      element.addEventListener('pointercancel', this._onCancel);
    }

    _emit(dx, dy) {
      if (this.listener) this.listener(dx, dy);
    }

    onDirection(handler) {
      this.listener = handler;
      return () => {
        this.listener = null;
      };
    }

    destroy() {
      this.element.removeEventListener('pointerdown', this._onDown);
      this.element.removeEventListener('pointerup', this._onUp);
      this.element.removeEventListener('pointercancel', this._onCancel);
    }
  }

  /* ---------------------------- Звук ----------------------------- */

  function tone(ctx, { freq, endFreq, duration, type = 'sine', volume = 0.05, delay = 0 }) {
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), start + duration);
    }

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  const SFX_PRESETS = {
    eat(ctx) {
      tone(ctx, { freq: 560, endFreq: 900, duration: 0.11, type: 'triangle', volume: 0.055 });
      tone(ctx, { freq: 840, endFreq: 1180, duration: 0.09, type: 'sine', volume: 0.03, delay: 0.035 });
    },
    die(ctx) {
      tone(ctx, { freq: 320, endFreq: 70, duration: 0.42, type: 'sawtooth', volume: 0.06 });
      tone(ctx, { freq: 180, endFreq: 55, duration: 0.5, type: 'square', volume: 0.035, delay: 0.05 });
    },
    start(ctx) {
      tone(ctx, { freq: 420, endFreq: 640, duration: 0.16, type: 'triangle', volume: 0.05 });
    },
    pause(ctx) {
      tone(ctx, { freq: 500, endFreq: 360, duration: 0.1, type: 'sine', volume: 0.035 });
    },
    win(ctx) {
      [523, 659, 784, 1046].forEach((freq, index) => {
        tone(ctx, { freq, duration: 0.18, type: 'triangle', volume: 0.05, delay: index * 0.07 });
      });
    },
  };

  class Sfx {
    constructor() {
      this.enabled = Storage.get('sound', true) !== false;
      this.ctx = null;
    }

    toggle() {
      this.enabled = !this.enabled;
      Storage.set('sound', this.enabled);
      if (this.enabled) this.play('pause');
      return this.enabled;
    }

    _context() {
      if (!this.ctx) {
        const Ctx = global.AudioContext || global.webkitAudioContext;
        if (!Ctx) return null;
        try {
          this.ctx = new Ctx();
        } catch (error) {
          return null;
        }
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    play(name) {
      if (!this.enabled) return;
      const preset = SFX_PRESETS[name];
      if (!preset) return;
      const ctx = this._context();
      if (!ctx) return;
      try {
        preset(ctx);
      } catch (error) {
        /* звук не критичен для игры */
      }
    }
  }

  /* --------------------------- Канвас ---------------------------- */

  class Stage {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.onResize = null;

      this._lastWidth = 0;
      this._lastHeight = 0;
      this._lastDpr = 0;

      this.fit = this.fit.bind(this);

      if (typeof ResizeObserver === 'function') {
        this._observer = new ResizeObserver(this.fit);
        this._observer.observe(canvas);
      }
      global.addEventListener('resize', this.fit);
      this.fit();
    }

    fit() {
      const rect = this.canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const dpr = clamp(global.devicePixelRatio || 1, 1, 3);

      if (width === this._lastWidth && height === this._lastHeight && dpr === this._lastDpr) {
        return;
      }

      this._lastWidth = width;
      this._lastHeight = height;
      this._lastDpr = dpr;
      this.width = width;
      this.height = height;
      this.dpr = dpr;

      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (typeof this.onResize === 'function') this.onResize(width, height);
    }

    destroy() {
      if (this._observer) this._observer.disconnect();
      global.removeEventListener('resize', this.fit);
      this.onResize = null;
    }
  }

  /* --------------------------- Экспорт --------------------------- */

  global.Platform = {
    Loop,
    Input,
    Swipe,
    Sfx,
    Stage,
    Storage,
    clamp,
    lerp,
    easeOutCubic,
    randomInt,
    roundRect,
    TAU,
  };
})(window);
