/**
 * interactive-background.js
 *
 * A reusable, embeddable canvas background that reacts to cursor movement,
 * clicks, and scroll — scoped to whatever container element you give it.
 *
 * Usage:
 *   import { InteractiveBackground } from "./interactive-background.js";
 *
 *   const bg = new InteractiveBackground(document.querySelector(".hero"), {
 *     particleCount: 80,
 *     baseColor: "#D4FF3F",   // lime — all particles/lines/ripples are shades of this
 *     shadeRange: 20,         // how much each particle's lightness randomly varies
 *     scrollShadeShift: 10,   // subtle overall lightness shift across scroll
 *     connectDistance: 110,
 *     cursorRadius: 140,    // how far the cursor's influence reaches
 *     cursorForce: 1.2,     // how strongly particles get pushed by the cursor
 *     clickRadius: 200,     // how far a click's ripple push reaches
 *     clickForce: 8,        // how strongly particles get pushed by a click
 *     scrollForce: 0.05,    // smooth drift strength from scrolling (same easing feel as cursor push)
 *     scrollForceMax: 6,    // cap on scroll-driven drift per frame
 *     randomWander: 0.02,   // constant idle jitter distance (subtle, not chaotic)
 *     particleSpeed: 0.15,  // constant idle drift speed
 *   });
 *
 *   // later, if needed:
 *   bg.destroy();
 */

export class InteractiveBackground {
  constructor(container, options = {}) {
    if (!container) {
      throw new Error("InteractiveBackground: a container element is required");
    }

    this.container = container;
    this.options = {
      particleCount: options.particleCount ?? 80,
      // Base color for all particles/lines/ripples — defaults to D4FF3F (lime).
      // Individual particles get randomized lighter/darker "shades" of this
      // color (see shadeRange) instead of the color hue shifting on scroll.
      baseColor: options.baseColor ?? "#D4FF3F",
      // How much lighter/darker (HSL lightness %) each particle's shade can
      // randomly vary from the base color, e.g. 20 = -20% to +20% lightness.
      shadeRange: options.shadeRange ?? 20,
      // How much the overall lightness shifts across scroll (subtle depth
      // cue), separate from each particle's fixed random shade.
      scrollShadeShift: options.scrollShadeShift ?? 10,
      connectDistance: options.connectDistance ?? 110, // line-connect radius
      cursorRadius: options.cursorRadius ?? 140, // how far cursor influence reaches
      particleSpeed: options.particleSpeed ?? 0.15,
      reactToPageScroll: options.reactToPageScroll ?? true, // false = react to container's own scroll position on page instead
      clickRipples: options.clickRipples ?? true,
      connections: options.connections ?? true,
      // Set true for full-page fixed backgrounds sitting BEHIND your content
      // (z-index: -1) where the container itself never receives mouse/click
      // events because content on top of it captures them first.
      globalEvents: options.globalEvents ?? false,
      // Each particle also gets a small continuous random wander even at rest.
      randomWander: options.randomWander ?? 0.02,
      // Cursor push: how strongly particles get shoved when within cursorRadius.
      cursorForce: options.cursorForce ?? 1.2,
      // Click ripple: how far its push effect reaches, and how strongly it shoves particles.
      clickRadius: options.clickRadius ?? 200,
      clickForce: options.clickForce ?? 8,
      // Scroll: smooth directional push applied to ALL particles (like gentle wind),
      // strength scaled by how fast you're currently scrolling. Same smooth easing
      // feel as the cursor push — no randomness.
      scrollForce: options.scrollForce ?? 0.05,
      scrollForceMax: options.scrollForceMax ?? 6, // cap on push distance per frame
    };

    // Precompute the base color's HSL so per-particle "shades" are just
    // lightness offsets of the same hue/saturation.
    this._baseHsl = this._hexToHsl(this.options.baseColor);

    this._setupDOM();
    this._setupState();
    this._bindEvents();
    this._createParticles();
    this._animate = this._animate.bind(this);
    this._raf = requestAnimationFrame(this._animate);
  }

  // ---------- Setup ----------

  _setupDOM() {
    // Make sure the container can host an absolutely-positioned canvas
    const computedPosition = getComputedStyle(this.container).position;
    if (computedPosition === "static") {
      this.container.style.position = "relative";
    }
    this.container.style.overflow = this.container.style.overflow || "hidden";

    this.canvas = document.createElement("canvas");
    this.canvas.style.position = "absolute";
    this.canvas.style.top = "0";
    this.canvas.style.left = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.zIndex = "0";
    this.canvas.style.pointerEvents = "none"; // let clicks reach real content
    this.canvas.style.display = "block";

    // Insert canvas as first child so it sits behind existing content
    this.container.insertBefore(this.canvas, this.container.firstChild);

    this.ctx = this.canvas.getContext("2d");
    this._resize();
  }

  _setupState() {
    this.mouse = { x: 0, y: 0, active: false };
    this.scrollProgress = 0;
    this.scrollVelocity = 0; // how fast the user is currently scrolling (smoothly decaying)
    this._lastScrollY = window.scrollY;
    this.particles = [];
    this.ripples = [];
    this._destroyed = false;
  }

  _createParticles() {
    this.particles = Array.from({ length: this.options.particleCount }, () =>
      this._makeParticle()
    );
  }

  _makeParticle() {
    const rand = (min, max) => Math.random() * (max - min) + min;
    return {
      x: rand(0, this.width),
      y: rand(0, this.height),
      baseSize: rand(1, 3),
      size: 0,
      vx: rand(-this.options.particleSpeed, this.options.particleSpeed),
      vy: rand(-this.options.particleSpeed, this.options.particleSpeed),
      // Each particle keeps a fixed random lightness offset from the base
      // color, so the field shows a natural mix of lighter/darker shades
      // of the same color instead of every dot being identical.
      shade: rand(-this.options.shadeRange, this.options.shadeRange),
    };
  }

  // ---------- Color helpers ----------

  /** Convert a "#RRGGBB" hex string to { h, s, l } (h in 0-360, s/l in 0-100). */
  _hexToHsl(hex) {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h *= 60;
    }

    return { h, s: s * 100, l: l * 100 };
  }

  /**
   * Build an hsla() string for the base color, offset by a lightness delta
   * (a particle's random shade and/or the scroll-driven shift) and alpha.
   */
  _shadeColor(lightnessOffset, alpha) {
    const { h, s } = this._baseHsl;
    const l = Math.min(90, Math.max(10, this._baseHsl.l + lightnessOffset));
    return `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
  }

  // ---------- Sizing ----------

  _resize() {
    const rect = this.container.getBoundingClientRect();
    this.width = this.canvas.width = rect.width;
    this.height = this.canvas.height = rect.height;
  }

  // ---------- Events ----------

  _bindEvents() {
    this._onMouseMove = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
      this.mouse.active = true;
    };
    this._onMouseLeave = () => (this.mouse.active = false);
    this._onResize = () => this._resize();

    this._onScroll = () => {
      if (this.options.reactToPageScroll) {
        const max = document.body.scrollHeight - window.innerHeight;
        this.scrollProgress = max > 0 ? window.scrollY / max : 0;
      } else {
        // react to container's own position passing through the viewport
        const rect = this.container.getBoundingClientRect();
        const total = rect.height + window.innerHeight;
        const passed = window.innerHeight - rect.top;
        this.scrollProgress = Math.min(1, Math.max(0, passed / total));
      }

      // Track how fast the user is scrolling right now (delta since last event)
      const currentY = window.scrollY;
      const delta = currentY - this._lastScrollY;
      this._lastScrollY = currentY;
      // Accumulate; the animate loop decays this back toward 0 each frame,
      // so bursts of fast scrolling spike it and it fades once you stop.
      this.scrollVelocity += delta;
    };

    this._onClick = (e) => {
      if (!this.options.clickRipples) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.ripples.push({ x, y, r: 0, alpha: 1 });

      this.particles.forEach((p) => {
        const dx = p.x - x;
        const dy = p.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < this.options.clickRadius) {
          const force =
            (1 - dist / this.options.clickRadius) * this.options.clickForce;
          p.x += (dx / dist) * force;
          p.y += (dy / dist) * force;
        }
      });
    };

    if (this.options.globalEvents) {
      // Full-page fixed background sitting behind content: the container
      // itself never receives events, so track mouse/click on window and
      // translate coordinates using the container's bounding rect.
      window.addEventListener("mousemove", this._onMouseMove);
      window.addEventListener("click", this._onClick);
      // no natural "mouseleave" on window; mouse.active just stays true,
      // which is fine for a full-page background.
    } else {
      // Scoped to the container only (e.g. a hero section with the canvas
      // behind its own content but not the whole page).
      this.container.addEventListener("mousemove", this._onMouseMove);
      this.container.addEventListener("mouseleave", this._onMouseLeave);
      this.container.addEventListener("click", this._onClick);
    }

    // Resize/scroll need to be window-level regardless
    window.addEventListener("resize", this._onResize);
    window.addEventListener("scroll", this._onScroll, { passive: true });
  }

  _unbindEvents() {
    if (this.options.globalEvents) {
      window.removeEventListener("mousemove", this._onMouseMove);
      window.removeEventListener("click", this._onClick);
    } else {
      this.container.removeEventListener("mousemove", this._onMouseMove);
      this.container.removeEventListener("mouseleave", this._onMouseLeave);
      this.container.removeEventListener("click", this._onClick);
    }
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("scroll", this._onScroll);
  }

  // ---------- Drawing ----------

  /** Lightness offset from scrolling (subtle depth shift, not a hue change). */
  _scrollShadeOffset() {
    return (this.scrollProgress - 0.5) * 2 * this.options.scrollShadeShift;
  }

  _drawConnections() {
    if (!this.options.connections) return;
    const scrollOffset = this._scrollShadeOffset();
    const { connectDistance } = this.options;
    const ctx = this.ctx;

    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const a = this.particles[i];
        const b = this.particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < connectDistance) {
          ctx.strokeStyle = this._shadeColor(
            scrollOffset,
            0.15 * (1 - dist / connectDistance)
          );
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
  }

  _updateAndDrawParticles() {
    const scrollOffset = this._scrollShadeOffset();
    const ctx = this.ctx;
    const { cursorRadius } = this.options;

    // Smooth directional push from scrolling — applied uniformly to every
    // particle, like a gentle wind. this.scrollVelocity already decays
    // smoothly (exponential falloff each frame, see _animate), so this
    // produces an easing motion rather than a random jolt: scroll down
    // and particles drift up slightly, ease back to rest once you stop.
    const scrollPush = Math.max(
      -this.options.scrollForceMax,
      Math.min(
        this.options.scrollForceMax,
        -this.scrollVelocity * this.options.scrollForce
      )
    );

    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;

      // Continuous subtle random wander, always on (very small, keeps drift organic)
      if (this.options.randomWander > 0) {
        p.x += (Math.random() - 0.5) * this.options.randomWander * 2;
        p.y += (Math.random() - 0.5) * this.options.randomWander * 2;
      }

      // Smooth scroll-driven drift, same for every particle
      p.y += scrollPush;

      if (p.x < -10) p.x = this.width + 10;
      if (p.x > this.width + 10) p.x = -10;
      if (p.y < -10) p.y = this.height + 10;
      if (p.y > this.height + 10) p.y = -10;

      if (this.mouse.active) {
        const dx = p.x - this.mouse.x;
        const dy = p.y - this.mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < cursorRadius) {
          const force = (1 - dist / cursorRadius) * this.options.cursorForce;
          p.x += (dx / (dist || 1)) * force;
          p.y += (dy / (dist || 1)) * force;
          p.size = p.baseSize + (1 - dist / cursorRadius) * 3;
        } else {
          p.size += (p.baseSize - p.size) * 0.1;
        }
      } else {
        p.size += (p.baseSize - p.size) * 0.1;
      }

      ctx.fillStyle = this._shadeColor(p.shade + scrollOffset, 0.8);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawRipples() {
    if (!this.options.clickRipples) return;
    const scrollOffset = this._scrollShadeOffset();
    const ctx = this.ctx;

    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.r += 4;
      r.alpha -= 0.02;
      if (r.alpha <= 0) {
        this.ripples.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = this._shadeColor(scrollOffset, r.alpha);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  _animate() {
    if (this._destroyed) return;
    this.ctx.clearRect(0, 0, this.width, this.height);
    this._drawConnections();
    this._updateAndDrawParticles();
    this._drawRipples();

    // Decay scroll velocity toward 0 each frame (exponential falloff) —
    // this is what makes the scroll-driven drift smooth/eased instead of jumpy.
    this.scrollVelocity *= 0.9;
    if (Math.abs(this.scrollVelocity) < 0.05) this.scrollVelocity = 0;

    this._raf = requestAnimationFrame(this._animate);
  }

  // ---------- Public API ----------

  /** Stop the animation and remove listeners/canvas (call on unmount / page nav) */
  destroy() {
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    this._unbindEvents();
    this.canvas.remove();
  }
}
