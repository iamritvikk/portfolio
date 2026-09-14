/* A small, dependency-free WebGL sculpture. All geometry is generated locally. */
(() => {
  'use strict';

  function startScene() {
    const canvas = document.getElementById('hero-scene');
    if (!canvas) return;

    const motionButton = document.getElementById('motion-toggle');
    const resetButton = document.getElementById('scene-reset');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const TAU = Math.PI * 2;
    const SEGMENTS = 300;
    const SIDES = 36;
    const TUBE_RADIUS = 0.43;
    const initialRotation = { x: 0.48, y: -0.29, z: -0.24 };
    const rotation = { ...initialRotation };
    const pointer = { x: 0, y: 0, smoothX: 0, smoothY: 0 };
    let paused = reducedMotion.matches;
    let userMotionChoice = false;
    let visible = true;
    let dragging = false;
    let pointerId = null;
    let lastX = 0;
    let lastY = 0;
    let frameId = 0;
    let lastTime = 0;
    let cssWidth = 1;
    let cssHeight = 1;
    let aspect = 1;
    let cameraDistance = 9.2;
    let renderer = null;

    const normalize = (v) => {
      const length = Math.hypot(...v) || 1;
      return v.map((value) => value / length);
    };
    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const knotPoint = (t) => {
      const radius = 1.64 + 0.58 * Math.cos(3 * t);
      return [radius * Math.cos(2 * t), radius * Math.sin(2 * t), 0.81 * Math.sin(3 * t)];
    };

    const centers = Array.from({ length: SEGMENTS + 1 }, (_, i) => knotPoint((i / SEGMENTS) * TAU));
    const positions = [];
    const normals = [];
    const occlusion = [];
    const indices = [];

    for (let i = 0; i <= SEGMENTS; i += 1) {
      const t = (i / SEGMENTS) * TAU;
      const center = centers[i];
      const previous = knotPoint(t - 0.001);
      const next = knotPoint(t + 0.001);
      const tangent = normalize(next.map((value, axis) => value - previous[axis]));
      const normal = normalize(cross(tangent, [0, 0, 1]));
      const binormal = normalize(cross(tangent, normal));

      for (let j = 0; j <= SIDES; j += 1) {
        const angle = (j / SIDES) * TAU;
        const direction = normal.map((value, axis) => value * Math.cos(angle) + binormal[axis] * Math.sin(angle));
        const point = center.map((value, axis) => value + direction[axis] * TUBE_RADIUS);
        let ambient = 1;
        // Gentle contact shading where separate lengths of the tube come together.
        for (let k = 0; k < SEGMENTS; k += 6) {
          const separation = Math.min(Math.abs(k - i), SEGMENTS - Math.abs(k - i));
          if (separation < 21) continue;
          const other = centers[k];
          const dx = other[0] - point[0];
          const dy = other[1] - point[1];
          const dz = other[2] - point[2];
          const distance = Math.hypot(dx, dy, dz);
          const facing = Math.max(0, (direction[0] * dx + direction[1] * dy + direction[2] * dz) / distance);
          ambient = Math.min(ambient, 1 - Math.max(0, 1.27 - distance) * facing * 0.39);
        }
        positions.push(...point);
        normals.push(...direction);
        occlusion.push(ambient);
      }
    }

    for (let i = 0; i < SEGMENTS; i += 1) {
      for (let j = 0; j < SIDES; j += 1) {
        const a = i * (SIDES + 1) + j;
        const b = a + SIDES + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }

    // Column-major rotation matrices, matching WebGL's matrix convention.
    function multiply(a, b) {
      const out = new Float32Array(16);
      for (let column = 0; column < 4; column += 1) {
        for (let row = 0; row < 4; row += 1) {
          for (let k = 0; k < 4; k += 1) {
            out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
          }
        }
      }
      return out;
    }

    function modelMatrix() {
      const x = rotation.x + pointer.smoothY * 0.12;
      const y = rotation.y + pointer.smoothX * 0.16;
      const z = rotation.z;
      const cx = Math.cos(x), sx = Math.sin(x);
      const cy = Math.cos(y), sy = Math.sin(y);
      const cz = Math.cos(z), sz = Math.sin(z);
      const rx = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1];
      const ry = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1];
      const rz = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      return multiply(rz, multiply(ry, rx));
    }

    function createWebGLRenderer() {
      const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false, powerPreference: 'low-power' });
      if (!gl) return null;

      const vertexSource = `
        attribute vec3 aPosition;
        attribute vec3 aNormal;
        attribute float aOcclusion;
        uniform mat4 uModel;
        uniform mat4 uProjection;
        uniform float uCamera;
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying float vOcclusion;
        void main() {
          vec4 world = uModel * vec4(aPosition, 1.0);
          vPosition = world.xyz;
          vNormal = mat3(uModel) * aNormal;
          vOcclusion = aOcclusion;
          world.z -= uCamera;
          gl_Position = uProjection * world;
        }
      `;

      const fragmentSource = `
        precision mediump float;
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying float vOcclusion;
        uniform float uCamera;
        void main() {
          vec3 n = normalize(vNormal);
          vec3 view = normalize(vec3(0.0, 0.0, uCamera) - vPosition);
          vec3 key = normalize(vec3(-3.5, 5.0, 5.0));
          vec3 fill = normalize(vec3(4.0, 1.5, 2.0));
          vec3 rim = normalize(vec3(2.0, 3.5, -4.0));
          float diffuse = max(dot(n, key), 0.0);
          float softFill = max(dot(n, fill), 0.0);
          float edge = pow(1.0 - max(dot(n, view), 0.0), 3.0);
          float specular = pow(max(dot(n, normalize(key + view)), 0.0), 46.0);
          float broadSpecular = pow(max(dot(n, normalize(fill + view)), 0.0), 12.0);
          float rimLight = pow(max(dot(n, rim), 0.0), 2.0);
          vec3 satin = vec3(0.66, 0.77, 0.20);
          vec3 color = satin * (0.22 + diffuse * 0.68 + softFill * 0.16) * vOcclusion;
          color += vec3(0.97, 1.0, 0.72) * specular * 0.82;
          color += vec3(0.70, 0.80, 0.37) * broadSpecular * 0.19;
          color += vec3(0.76, 0.92, 0.44) * rimLight * 0.23;
          color += vec3(0.30, 0.38, 0.13) * edge * 0.24;
          color = pow(color, vec3(0.82));
          gl_FragColor = vec4(color, 1.0);
        }
      `;

      function compile(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          gl.deleteShader(shader);
          throw new Error('The sculpture shader could not be compiled.');
        }
        return shader;
      }

      const vertexShader = compile(gl.VERTEX_SHADER, vertexSource);
      const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);
      const program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('The sculpture renderer could not start.');
      gl.useProgram(program);

      const buffers = [];
      function attribute(name, data, size) {
        const buffer = gl.createBuffer();
        buffers.push(buffer);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
        const location = gl.getAttribLocation(program, name);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
      }

      attribute('aPosition', positions, 3);
      attribute('aNormal', normals, 3);
      attribute('aOcclusion', occlusion, 1);
      const indexBuffer = gl.createBuffer();
      buffers.push(indexBuffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

      const uniforms = {
        model: gl.getUniformLocation(program, 'uModel'),
        projection: gl.getUniformLocation(program, 'uProjection'),
        camera: gl.getUniformLocation(program, 'uCamera'),
      };
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.clearColor(0, 0, 0, 0);
      canvas.dataset.renderer = 'webgl';

      return {
        draw(model) {
          gl.viewport(0, 0, canvas.width, canvas.height);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          const near = 0.1;
          const far = 40;
          const focal = 1 / Math.tan((38 * Math.PI) / 360);
          const projection = new Float32Array([
            focal / aspect, 0, 0, 0,
            0, focal, 0, 0,
            0, 0, (far + near) / (near - far), -1,
            0, 0, (2 * far * near) / (near - far), 0,
          ]);
          gl.useProgram(program);
          gl.uniformMatrix4fv(uniforms.model, false, model);
          gl.uniformMatrix4fv(uniforms.projection, false, projection);
          gl.uniform1f(uniforms.camera, cameraDistance);
          gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
        },
        dispose() {
          buffers.forEach((buffer) => gl.deleteBuffer(buffer));
          gl.deleteProgram(program);
        },
      };
    }

    function createCanvasRenderer() {
      // A canvas that already owns WebGL cannot acquire a 2D context, even if
      // shader compilation failed. Keep the interactive canvas and layer a
      // separate, non-interactive drawing surface over it in that case.
      let surface = canvas;
      let context = null;
      try { context = surface.getContext('2d'); } catch { /* Try a new surface. */ }
      if (!context) {
        surface = document.createElement('canvas');
        try { context = surface.getContext('2d'); } catch { /* Use SVG below. */ }
        if (context) {
          surface.setAttribute('aria-hidden', 'true');
          Object.assign(surface.style, { position: 'absolute', pointerEvents: 'none', zIndex: window.getComputedStyle(canvas).zIndex });
          canvas.after(surface);
        }
      }
      if (!context) return null;
      canvas.dataset.renderer = 'canvas2d';
      return {
        draw(model) {
          if (surface !== canvas) {
            if (surface.width !== canvas.width) surface.width = canvas.width;
            if (surface.height !== canvas.height) surface.height = canvas.height;
            Object.assign(surface.style, { left: `${canvas.offsetLeft}px`, top: `${canvas.offsetTop}px`, width: `${cssWidth}px`, height: `${cssHeight}px` });
          }
          const scale = canvas.height / (2 * Math.tan((38 * Math.PI) / 360));
          const projected = centers.map((p) => {
            const x = model[0] * p[0] + model[4] * p[1] + model[8] * p[2];
            const y = model[1] * p[0] + model[5] * p[1] + model[9] * p[2];
            const z = model[2] * p[0] + model[6] * p[1] + model[10] * p[2];
            const perspective = scale / (cameraDistance - z);
            return { x: canvas.width / 2 + x * perspective, y: canvas.height / 2 - y * perspective, z, radius: TUBE_RADIUS * perspective };
          });
          const segments = projected.slice(0, -1).map((point, i) => ({ a: point, b: projected[i + 1] }));
          segments.sort((a, b) => (a.a.z + a.b.z) - (b.a.z + b.b.z));
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.lineCap = 'round';
          for (const { a, b } of segments) {
            const radius = (a.radius + b.radius) / 2;
            const gradient = context.createLinearGradient(a.x - radius, a.y - radius, a.x + radius, a.y + radius);
            gradient.addColorStop(0, '#eff7b8');
            gradient.addColorStop(0.28, '#c8dc66');
            gradient.addColorStop(0.64, '#889c38');
            gradient.addColorStop(1, '#39451d');
            context.strokeStyle = gradient;
            context.lineWidth = radius * 2;
            context.beginPath();
            context.moveTo(a.x, a.y);
            context.lineTo(b.x, b.y);
            context.stroke();
          }
        },
        dispose() { if (surface !== canvas) surface.remove(); },
      };
    }

    function createStaticRenderer() {
      const namespace = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(namespace, 'svg');
      svg.setAttribute('viewBox', '0 0 600 600');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'An abstract lime sculpture connecting engineering and data.');
      Object.assign(svg.style, { position: 'absolute', pointerEvents: 'none', zIndex: window.getComputedStyle(canvas).zIndex });
      const defs = document.createElementNS(namespace, 'defs');
      const gradient = document.createElementNS(namespace, 'linearGradient');
      gradient.id = 'hero-sculpture-fallback-light';
      gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
      gradient.setAttribute('x1', '50');
      gradient.setAttribute('y1', '0');
      gradient.setAttribute('x2', '550');
      gradient.setAttribute('y2', '600');
      for (const [offset, color] of [['0%', '#eef7b7'], ['35%', '#c6dc64'], ['72%', '#879b38'], ['100%', '#39451d']]) {
        const stop = document.createElementNS(namespace, 'stop');
        stop.setAttribute('offset', offset);
        stop.setAttribute('stop-color', color);
        gradient.append(stop);
      }
      defs.append(gradient);
      svg.append(defs);
      const model = modelMatrix();
      const points = centers.map((p) => {
        const x = model[0] * p[0] + model[4] * p[1] + model[8] * p[2];
        const y = model[1] * p[0] + model[5] * p[1] + model[9] * p[2];
        const z = model[2] * p[0] + model[6] * p[1] + model[10] * p[2];
        const scale = 870 / (9.2 - z);
        return { x: 300 + x * scale, y: 300 - y * scale, z, radius: TUBE_RADIUS * scale };
      });
      const segments = points.slice(0, -1).map((point, i) => ({ a: point, b: points[i + 1] }));
      segments.sort((a, b) => (a.a.z + a.b.z) - (b.a.z + b.b.z));
      for (const { a, b } of segments) {
        const path = document.createElementNS(namespace, 'path');
        path.setAttribute('d', `M${a.x},${a.y}L${b.x},${b.y}`);
        path.setAttribute('stroke', 'url(#hero-sculpture-fallback-light)');
        path.setAttribute('stroke-width', String(a.radius + b.radius));
        path.setAttribute('stroke-linecap', 'round');
        svg.append(path);
      }
      canvas.after(svg);
      canvas.dataset.renderer = 'svg';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.tabIndex = -1;
      canvas.parentElement?.classList.add('scene-fallback');
      paused = true;
      if (motionButton) motionButton.disabled = true;
      if (resetButton) resetButton.disabled = true;
      return {
        static: true,
        draw() {
          Object.assign(svg.style, { left: `${canvas.offsetLeft}px`, top: `${canvas.offsetTop}px`, width: `${cssWidth}px`, height: `${cssHeight}px` });
        },
        dispose() { svg.remove(); },
      };
    }

    function initializeRenderer() {
      renderer?.dispose();
      canvas.removeAttribute('aria-hidden');
      canvas.tabIndex = 0;
      canvas.parentElement?.classList.remove('scene-fallback');
      if (motionButton) motionButton.disabled = false;
      if (resetButton) resetButton.disabled = false;
      try {
        renderer = createWebGLRenderer();
      } catch {
        renderer = null;
      }
      if (!renderer) renderer = createCanvasRenderer();
      if (!renderer) renderer = createStaticRenderer();
    }

    function updateMotionButton() {
      if (!motionButton) return;
      motionButton.setAttribute('aria-pressed', String(paused));
      motionButton.setAttribute('aria-label', paused ? 'Play 3D animation' : 'Pause 3D animation');
      motionButton.dataset.paused = String(paused);
      const label = motionButton.querySelector('[data-motion-label]');
      if (label) label.textContent = paused ? 'Play motion' : 'Pause motion';
    }

    function requestDraw() {
      if (frameId || !renderer || !visible || document.hidden) return;
      frameId = window.requestAnimationFrame(animate);
    }

    function animate(time) {
      frameId = 0;
      if (!renderer || !visible || document.hidden) return;
      const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.045) : 0;
      lastTime = time;
      if (!paused && !dragging) {
        rotation.y += delta * 0.13;
        rotation.z += delta * 0.023;
      }
      pointer.smoothX += (pointer.x - pointer.smoothX) * 0.075;
      pointer.smoothY += (pointer.y - pointer.smoothY) * 0.075;
      renderer.draw(modelMatrix());
      const settling = Math.abs(pointer.x - pointer.smoothX) + Math.abs(pointer.y - pointer.smoothY) > 0.003;
      if (!paused || dragging || settling) requestDraw();
    }

    function stopFrames() {
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = 0;
      lastTime = 0;
    }

    function resize() {
      const bounds = canvas.getBoundingClientRect();
      cssWidth = Math.max(1, bounds.width);
      cssHeight = Math.max(1, bounds.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(cssWidth * dpr);
      const height = Math.round(cssHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      aspect = cssWidth / cssHeight;
      cameraDistance = 9.2 * Math.max(1, 0.92 / aspect);
      requestDraw();
    }

    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Interactive lime sculpture. Drag or use arrow keys to orbit. Press Home to reset. Motion controls follow.');
    canvas.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown Home');
    initializeRenderer();

    function resetView() {
      Object.assign(rotation, initialRotation);
      Object.assign(pointer, { x: 0, y: 0, smoothX: 0, smoothY: 0 });
      requestDraw();
    }

    canvas.addEventListener('keydown', (event) => {
      if (!renderer || renderer.static || event.altKey || event.ctrlKey || event.metaKey) return;
      const step = event.shiftKey ? 0.3 : 0.12;
      switch (event.key) {
        case 'ArrowLeft': rotation.y -= step; break;
        case 'ArrowRight': rotation.y += step; break;
        case 'ArrowUp': rotation.x -= step; break;
        case 'ArrowDown': rotation.x += step; break;
        case 'Home': resetView(); break;
        default: return;
      }
      event.preventDefault();
      requestDraw();
    });

    canvas.style.touchAction = 'pan-y';
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || pointerId !== null || renderer?.static) return;
      dragging = true;
      pointerId = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(pointerId);
      canvas.style.cursor = 'grabbing';
      requestDraw();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (dragging && event.pointerId === pointerId) {
        rotation.y += ((event.clientX - lastX) / cssWidth) * 5;
        rotation.x += ((event.clientY - lastY) / cssHeight) * 5;
        lastX = event.clientX;
        lastY = event.clientY;
        requestDraw();
      } else if (!paused && event.pointerType !== 'touch') {
        const bounds = canvas.getBoundingClientRect();
        pointer.x = ((event.clientX - bounds.left) / cssWidth - 0.5) * 2;
        pointer.y = ((event.clientY - bounds.top) / cssHeight - 0.5) * 2;
        requestDraw();
      }
    });
    const endDrag = (event) => {
      if (event.pointerId !== pointerId) return;
      dragging = false;
      pointerId = null;
      canvas.style.cursor = 'grab';
      requestDraw();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('lostpointercapture', endDrag);
    canvas.addEventListener('pointerleave', () => {
      pointer.x = 0;
      pointer.y = 0;
      requestDraw();
    });

    motionButton?.addEventListener('click', () => {
      paused = !paused;
      userMotionChoice = true;
      pointer.x = 0;
      pointer.y = 0;
      updateMotionButton();
      requestDraw();
    });
    resetButton?.addEventListener('click', resetView);

    const motionPreferenceChanged = (event) => {
      if (userMotionChoice || renderer?.static) return;
      paused = event.matches;
      if (paused) Object.assign(pointer, { x: 0, y: 0, smoothX: 0, smoothY: 0 });
      updateMotionButton();
      requestDraw();
    };
    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', motionPreferenceChanged);
    else reducedMotion.addListener(motionPreferenceChanged);

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) requestDraw();
        else stopFrames();
      }, { rootMargin: '80px' });
      observer.observe(canvas);
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopFrames();
      else requestDraw();
    });
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
    window.addEventListener('resize', resize, { passive: true });

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      stopFrames();
      renderer?.dispose();
      renderer = null;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      initializeRenderer();
      resize();
    });
    window.addEventListener('pagehide', stopFrames);
    window.addEventListener('pageshow', requestDraw);

    updateMotionButton();
    resize();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startScene, { once: true });
  else startScene();
})();
