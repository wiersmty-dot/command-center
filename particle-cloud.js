customElements.define('particle-cloud', class extends HTMLElement {
  connectedCallback() {
    const size = parseInt(this.getAttribute('size') || '660', 10);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = document.createElement('canvas');
    c.width = size * dpr; c.height = size * dpr;
    c.style.cssText = 'width:100%;height:100%;display:block';
    this.style.display = 'block';
    this.appendChild(c);
    const ctx = c.getContext('2d');
    let seed = 42;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const gauss = () => (rnd() + rnd() + rnd()) / 1.5 - 1;
    const light = this.getAttribute('theme') === 'light';
    const palette = light ? [
      [6, 6, 6], [6, 6, 6], [14, 14, 14], [26, 26, 26],
      [7, 150, 138], [11, 196, 180], [214, 84, 0], [60, 60, 60]
    ] : [
      [255, 255, 255], [255, 255, 255], [255, 240, 220],
      [255, 122, 26], [255, 90, 140], [80, 220, 200], [150, 130, 255], [255, 200, 90]
    ];
    const P = [];
    const N = 1650;
    for (let i = 0; i < N; i++) {
      const sparse = rnd() < 0.14;
      const r = sparse ? 130 + rnd() * 180 : Math.abs(gauss()) * 115;
      P.push({
        a: rnd() * Math.PI * 2,
        r,
        s: sparse ? 0.5 + rnd() * 0.8 : 0.6 + rnd() * 1.5,
        col: palette[Math.floor(rnd() * palette.length)],
        base: (sparse ? 0.12 + rnd() * 0.2 : 0.25 + rnd() * 0.6) * (light ? 1.5 : 1),
        ph: rnd() * Math.PI * 2,
        tw: (0.4 + rnd() * 1.2) * 1.7,
        rot: (0.014 + rnd() * 0.05) * (rnd() < 0.5 ? 1 : -1),
        br: 3 + rnd() * 9,
        bs: 0.25 + rnd() * 0.7,
        bp: rnd() * Math.PI * 2,
        flare: rnd() < 0.05
      });
    }
    const cx = size / 2, cy = size / 2;
    let raf;
    const draw = (t) => {
      const time = t / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 180);
      g.addColorStop(0, light ? 'rgba(11,196,180,0.07)' : 'rgba(255,150,80,0.10)');
      g.addColorStop(0.5, light ? 'rgba(0,0,0,0.03)' : 'rgba(120,90,140,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      const breathe = 1 + 0.022 * Math.sin(time * 0.55);
      for (const p of P) {
        const a = p.a + time * p.rot;
        const r = (p.r + Math.sin(time * p.bs + p.bp) * p.br) * breathe;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r * 0.92;
        let alpha = p.base * (0.42 + 0.58 * Math.sin(time * p.tw + p.ph));
        if (p.flare) {
          const f = Math.sin(time * 2.6 + p.ph);
          if (f > 0.86) alpha += 0.5 * (f - 0.86) / 0.14;
        }
        if (alpha <= 0.004) continue;
        ctx.fillStyle = 'rgba(' + p.col[0] + ',' + p.col[1] + ',' + p.col[2] + ',' + alpha.toFixed(3) + ')';
        ctx.fillRect(x, y, p.s, p.s);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    this._stop = () => cancelAnimationFrame(raf);
  }
  disconnectedCallback() { if (this._stop) this._stop(); }
});
