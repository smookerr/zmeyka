/* =========================================================
   Сама игра: логика змейки, еда, частицы и отрисовка.
   Слой не знает про DOM — получает канвас и колбэки.
   ========================================================= */

(function (global) {
  'use strict';

  const P = global.Platform;
  const { clamp, lerp, randomInt, roundRect, TAU } = P;

  const CONFIG = {
    cols: 21,
    rows: 21,
    startLength: 4,
    baseStep: 150,        // мс на клетку в начале
    minStep: 75,          // предел скорости
    speedUpPerFood: 3,    // насколько быстрее за каждую сферу
    pointsPerFood: 10,
  };

  const PALETTE = {
    head: [157, 255, 196],
    tail: [10, 122, 74],
    food: [255, 93, 115],
    foodLight: [255, 206, 214],
  };

  const mix = (a, b, t) => [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];

  const rgb = (color, alpha = 1) => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;

  class Game {
    constructor({ stage, sfx, onScore, onState }) {
      this.stage = stage;
      this.ctx = stage.ctx;
      this.sfx = sfx;
      this.onScore = onScore || (() => {});
      this.onState = onState || (() => {});

      this.best = Number(P.Storage.get('best', 0)) || 0;
      this.time = 0;
      this.acc = 0;
      this.particles = [];
      this.shake = 0;
      this.flash = 0;
      this.flashColor = PALETTE.food;
      this.board = { x: 0, y: 0, size: 0, cell: 1 };

      this.resize();
      this.reset('idle', { silent: true });
    }

    /* ------------------------- Состояние ------------------------- */

    reset(mode = 'idle', { silent = false } = {}) {
      const cols = CONFIG.cols;
      const rows = CONFIG.rows;
      const startX = Math.floor(cols / 2) - 1;
      const startY = Math.floor(rows / 2);

      this.snake = [];
      for (let i = 0; i < CONFIG.startLength; i += 1) {
        this.snake.push({ x: startX - i, y: startY });
      }

      this.prevSnake = this.snake.map((segment) => ({ ...segment }));
      this.dir = { x: 1, y: 0 };
      this.queue = [];
      this.score = 0;
      this.stepMs = CONFIG.baseStep;
      this.acc = 0;
      this.state = mode;
      this.food = this.spawnFood();
      this.particles.length = 0;
      this.shake = 0;
      this.flash = 0;

      if (!silent) {
        this.onScore(this.score);
        this.onState(this.state);
      }
    }

    start() {
      this.reset('playing');
      this.sfx.play('start');
    }

    pause() {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      this.sfx.play('pause');
      this.onState(this.state);
    }

    resume() {
      if (this.state !== 'paused') return;
      this.state = 'playing';
      this.onState(this.state);
    }

    togglePause() {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    }

    /** Поворот. Из состояния ожидания сразу начинает игру. */
    steer(dx, dy) {
      if (this.state === 'idle') this.start();
      if (this.state !== 'playing') return;

      const last = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
      if (last.x === -dx && last.y === -dy) return; // разворот на 180°
      if (last.x === dx && last.y === dy) return;   // уже туда идём
      if (this.queue.length >= 2) return;
      this.queue.push({ x: dx, y: dy });
    }

    /* --------------------------- Жизнь ---------------------------- */

    update(dt) {
      this.time += dt;
      this._updateParticles(dt);

      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.6);
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 1.8);

      if (this.state !== 'playing') return;

      this.acc += dt * 1000;
      let steps = 0;
      while (this.acc >= this.stepMs && steps < 4) {
        this.acc -= this.stepMs;
        this._step();
        steps += 1;
        if (this.state !== 'playing') {
          this.acc = 0;
          break;
        }
      }
      if (steps === 4) this.acc = 0;
    }

    _step() {
      if (this.queue.length) {
        const next = this.queue.shift();
        if (!(next.x === -this.dir.x && next.y === -this.dir.y)) this.dir = next;
      }

      const head = this.snake[0];
      const nx = head.x + this.dir.x;
      const ny = head.y + this.dir.y;

      // стены
      if (nx < 0 || ny < 0 || nx >= CONFIG.cols || ny >= CONFIG.rows) {
        this._die();
        return;
      }

      const eating = Boolean(this.food) && nx === this.food.x && ny === this.food.y;
      const limit = eating ? this.snake.length : this.snake.length - 1;

      // хвост уходит из клетки в этом же шаге, поэтому в него можно въехать
      for (let i = 0; i < limit; i += 1) {
        if (this.snake[i].x === nx && this.snake[i].y === ny) {
          this._die();
          return;
        }
      }

      this.prevSnake = this.snake.map((segment) => ({ ...segment }));

      this.snake.unshift({ x: nx, y: ny });
      if (eating) {
        this._eat(nx, ny);
      } else {
        this.snake.pop();
      }

      while (this.prevSnake.length < this.snake.length) {
        const tail = this.snake[this.snake.length - 1];
        this.prevSnake.push({ ...tail });
      }
    }

    _eat(x, y) {
      this.score += CONFIG.pointsPerFood;
      this.onScore(this.score);

      this.stepMs = Math.max(CONFIG.minStep, this.stepMs - CONFIG.speedUpPerFood);
      this._burst(x, y, PALETTE.food, 16);
      this.sfx.play('eat');

      this.food = this.spawnFood();
      if (!this.food) this._win();
    }

    _die() {
      this.state = 'over';
      this.shake = 1;
      this.flash = 1;
      this.flashColor = PALETTE.food;
      this._saveBest();

      const head = this.snake[0];
      this._burst(head.x, head.y, PALETTE.head, 28);
      this.sfx.play('die');
      this.onState(this.state);
    }

    _win() {
      this.state = 'won';
      this.flash = 0.85;
      this.flashColor = [120, 255, 190];
      this._saveBest();
      this.sfx.play('win');
      this.onState(this.state);
    }

    _saveBest() {
      if (this.score > this.best) {
        this.best = this.score;
        P.Storage.set('best', this.best);
      }
    }

    spawnFood() {
      const total = CONFIG.cols * CONFIG.rows;
      const occupied = new Set(this.snake.map((segment) => segment.y * CONFIG.cols + segment.x));
      if (occupied.size >= total) return null;

      const free = [];
      for (let i = 0; i < total; i += 1) {
        if (!occupied.has(i)) free.push(i);
      }

      const index = free[randomInt(free.length)];
      return { x: index % CONFIG.cols, y: Math.floor(index / CONFIG.cols) };
    }

    resize() {
      const { width, height } = this.stage;
      const margin = clamp(Math.min(width, height) * 0.035, 6, 26);
      const size = Math.max(60, Math.min(width, height) - margin * 2);
      this.board = {
        x: (width - size) / 2,
        y: (height - size) / 2,
        size,
        cell: size / CONFIG.cols,
      };
    }

    /* -------------------------- Частицы -------------------------- */

    _burst(cellX, cellY, color, count) {
      const { board } = this;
      const x = board.x + (cellX + 0.5) * board.cell;
      const y = board.y + (cellY + 0.5) * board.cell;

      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * TAU;
        const speed = board.cell * (0.7 + Math.random() * 3.1);
        const life = 0.35 + Math.random() * 0.45;
        this.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life,
          maxLife: life,
          size: Math.max(1.2, board.cell * (0.05 + Math.random() * 0.09)),
          color: mix(color, [255, 255, 255], Math.random() * 0.55),
        });
      }

      if (this.particles.length > 420) this.particles.splice(0, this.particles.length - 420);
    }

    _updateParticles(dt) {
      const damping = Math.exp(-dt * 3.3);
      for (let i = this.particles.length - 1; i >= 0; i -= 1) {
        const particle = this.particles[i];
        particle.life -= dt;
        if (particle.life <= 0) {
          this.particles.splice(i, 1);
          continue;
        }
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vx *= damping;
        particle.vy *= damping;
      }
    }

    /* ------------------------- Отрисовка ------------------------- */

    render() {
      const { ctx, stage } = this;
      const width = stage.width;
      const height = stage.height;

      ctx.save();
      ctx.clearRect(0, 0, width, height);
      this._paintBackground(width, height);

      if (this.shake > 0.01) {
        const amp = this.shake * Math.min(9, this.board.cell * 0.3);
        ctx.translate((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
      }

      this._paintBoard();
      this._paintFood();
      this._paintSnake();
      this._paintParticles();
      ctx.restore();

      this._paintFlash(width, height);
    }

    _paintBackground(width, height) {
      const ctx = this.ctx;

      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#070d17');
      gradient.addColorStop(1, '#04070d');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      const halo = ctx.createRadialGradient(
        width / 2, height * 0.16, 0,
        width / 2, height * 0.16, height * 0.95
      );
      halo.addColorStop(0, 'rgba(62, 240, 139, 0.075)');
      halo.addColorStop(0.55, 'rgba(53, 200, 255, 0.03)');
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, width, height);
    }

    _paintBoard() {
      const { ctx, board } = this;
      const radius = Math.max(12, board.cell * 0.7);

      roundRect(ctx, board.x, board.y, board.size, board.size, radius);
      const fill = ctx.createLinearGradient(board.x, board.y, board.x + board.size, board.y + board.size);
      fill.addColorStop(0, '#0d1727');
      fill.addColorStop(1, '#070d18');
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.save();
      ctx.clip();

      const dot = Math.max(0.7, board.cell * 0.03);
      ctx.fillStyle = 'rgba(120, 190, 255, 0.085)';
      for (let y = 1; y < CONFIG.rows; y += 1) {
        for (let x = 1; x < CONFIG.cols; x += 1) {
          ctx.beginPath();
          ctx.arc(board.x + x * board.cell, board.y + y * board.cell, dot, 0, TAU);
          ctx.fill();
        }
      }

      const centerX = board.x + board.size / 2;
      const centerY = board.y + board.size / 2;
      const halo = ctx.createRadialGradient(
        centerX, centerY, board.size * 0.08,
        centerX, centerY, board.size * 0.78
      );
      halo.addColorStop(0, 'rgba(62, 240, 139, 0.055)');
      halo.addColorStop(1, 'rgba(62, 240, 139, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(board.x, board.y, board.size, board.size);

      ctx.restore();

      ctx.save();
      ctx.strokeStyle = 'rgba(120, 220, 255, 0.15)';
      ctx.lineWidth = Math.max(1, board.cell * 0.06);
      roundRect(ctx, board.x + 0.5, board.y + 0.5, board.size - 1, board.size - 1, radius);
      ctx.stroke();
      ctx.restore();
    }

    _paintFood() {
      if (!this.food) return;

      const { ctx, board, time } = this;
      const pulse = 0.5 + 0.5 * Math.sin(time * 4.6);
      const cx = board.x + (this.food.x + 0.5) * board.cell;
      const cy = board.y + (this.food.y + 0.5) * board.cell;
      const radius = board.cell * (0.3 + pulse * 0.03);

      ctx.save();
      ctx.shadowColor = 'rgba(255, 93, 115, 0.9)';
      ctx.shadowBlur = board.cell * (0.55 + pulse * 0.5);

      const orb = ctx.createRadialGradient(
        cx - radius * 0.35, cy - radius * 0.45, radius * 0.1,
        cx, cy, radius
      );
      orb.addColorStop(0, rgb(PALETTE.foodLight));
      orb.addColorStop(0.55, rgb(PALETTE.food));
      orb.addColorStop(1, '#b81f3c');

      ctx.fillStyle = orb;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TAU);
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = `rgba(255, 160, 178, ${0.16 + pulse * 0.22})`;
      ctx.lineWidth = Math.max(1, board.cell * 0.05);
      ctx.beginPath();
      ctx.arc(cx, cy, board.cell * (0.42 + pulse * 0.05), 0, TAU);
      ctx.stroke();
    }

    _paintSnake() {
      const { ctx, board } = this;
      const cell = board.cell;
      const n = this.snake.length;
      if (!n) return;

      const t = this.state === 'playing' || this.state === 'paused'
        ? clamp(this.acc / this.stepMs, 0, 1)
        : 0;

      const points = new Array(n);
      for (let i = 0; i < n; i += 1) {
        const segment = this.snake[i];
        const prev = this.prevSnake[i] || segment;
        points[i] = {
          x: board.x + (lerp(prev.x, segment.x, t) + 0.5) * cell,
          y: board.y + (lerp(prev.y, segment.y, t) + 0.5) * cell,
        };
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Тело рисуем от хвоста к голове, чтобы голова оказалась сверху.
      for (let i = n - 1; i > 0; i -= 1) {
        const k = i / (n - 1);
        const color = mix(PALETTE.tail, PALETTE.head, Math.pow(1 - k, 0.7));
        ctx.strokeStyle = rgb(color);
        ctx.lineWidth = cell * (0.74 - 0.12 * k);
        ctx.beginPath();
        ctx.moveTo(points[i].x, points[i].y);
        ctx.lineTo(points[i - 1].x, points[i - 1].y);
        ctx.stroke();
      }

      const head = points[0];
      const radius = cell * 0.43;

      ctx.save();
      ctx.shadowColor = 'rgba(96, 255, 168, 0.7)';
      ctx.shadowBlur = cell * 0.9;

      const headFill = ctx.createRadialGradient(
        head.x - radius * 0.35, head.y - radius * 0.4, radius * 0.15,
        head.x, head.y, radius
      );
      headFill.addColorStop(0, '#d6ffe8');
      headFill.addColorStop(0.45, rgb(PALETTE.head));
      headFill.addColorStop(1, '#2bd97e');

      ctx.fillStyle = headFill;
      ctx.beginPath();
      ctx.arc(head.x, head.y, radius, 0, TAU);
      ctx.fill();
      ctx.restore();

      // Глаза повёрнуты по направлению движения.
      const dx = this.dir.x;
      const dy = this.dir.y;
      const px = -dy;
      const py = dx;
      const eyeRadius = Math.max(1.3, cell * 0.075);

      for (let side = -1; side <= 1; side += 2) {
        const ex = head.x + dx * cell * 0.14 + px * cell * 0.17 * side;
        const ey = head.y + dy * cell * 0.14 + py * cell * 0.17 * side;

        ctx.fillStyle = 'rgba(6, 22, 14, 0.92)';
        ctx.beginPath();
        ctx.arc(ex, ey, eyeRadius, 0, TAU);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(ex - eyeRadius * 0.35, ey - eyeRadius * 0.35, eyeRadius * 0.36, 0, TAU);
        ctx.fill();
      }
    }

    _paintParticles() {
      const ctx = this.ctx;
      if (!this.particles.length) return;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const particle of this.particles) {
        const alpha = clamp(particle.life / particle.maxLife, 0, 1);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = rgb(particle.color);
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size * (0.4 + alpha * 0.6), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    _paintFlash(width, height) {
      if (this.flash <= 0) return;
      const ctx = this.ctx;
      ctx.save();
      ctx.fillStyle = rgb(this.flashColor, this.flash * 0.26);
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
  }

  global.Snake = { Game, CONFIG };
})(window);
