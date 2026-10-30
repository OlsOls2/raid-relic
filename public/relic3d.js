import { growthSummary, presentGrowth, pulseGrowth, clearGrowthFeedback } from './growth.js';
import { presentEdition } from './edition-view.js';
import { selectEdition } from './editions.js';
import { runePose } from './cinematic.js';
// Original procedural renderer. The reviewed local Three.js vendor is optional;
// failed imports, reduced motion and context loss retain the original SVG.
export const DEFAULT_DESIGN = Object.freeze({
  version: 1,
  shape: 'crystal',
  facets: 6,
  aspect: 1,
  palette: ['#101d30', '#dce4ed', '#9486b7', '#c7edfa'],
});
export function validRelicDesign(d) {
  return (
    d &&
    Object.keys(d).sort().join(',') === 'aspect,facets,palette,shape,version' &&
    d.version === 1 &&
    ['crystal', 'orb', 'seed'].includes(d.shape) &&
    Number.isInteger(d.facets) &&
    d.facets >= 3 &&
    d.facets <= 12 &&
    Number.isFinite(d.aspect) &&
    d.aspect >= 0.6 &&
    d.aspect <= 1.6 &&
    Array.isArray(d.palette) &&
    d.palette.length === 4 &&
    d.palette.every((c) => /^#[0-9a-f]{6}$/.test(c))
  );
}
export function crystalMesh(design = DEFAULT_DESIGN) {
  if (!validRelicDesign(design)) throw Error('Invalid relic design');
  const positions = [],
    colors = [];
  const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const radius = design.shape === 'orb' ? 0.68 : design.shape === 'seed' ? 0.5 : 0.6;
  const levels = [
    [-1, 0],
    [-0.35, radius * 0.78],
    [0.15, radius],
    [0.6, radius * 0.58],
    [1, 0],
  ];
  const point = (i, level) => {
    const angle = (i * Math.PI * 2) / design.facets;
    return [Math.cos(angle) * level[1], level[0] * design.aspect, Math.sin(angle) * level[1]];
  };
  const triangle = (vertices, color) => {
    positions.push(...vertices.flat());
    for (let v = 0; v < 3; v++) colors.push(...rgb(color));
  };
  for (let layer = 0; layer < levels.length - 1; layer++)
    for (let i = 0; i < design.facets; i++) {
      const a = point(i, levels[layer]),
        b = point(i + 1, levels[layer]);
      const c = point(i, levels[layer + 1]),
        d = point(i + 1, levels[layer + 1]);
      const tint = design.palette[1 + ((i + layer) % 3)];
      if (levels[layer][1] !== 0) triangle([a, b, c], tint);
      if (levels[layer + 1][1] !== 0) triangle([b, d, c], tint);
    }
  return { positions, colors, triangles: positions.length / 9 };
}
// DPR1 physical bounds; uniform cap preserves the CSS aspect without oversampling.
export function renderViewport(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scale = Math.min(1, 480 / Math.max(width, height));
  const w = Math.max(1, Math.min(480, Math.round(width * scale))),
    h = Math.max(1, Math.min(480, Math.round(height * scale)));
  return { width: w, height: h, aspect: w / h };
}
// Context attribute chosen once; resizing never churns a live context. Invalid bounds keep normal AA.
export function lowPowerWidget(width, height, corner = false) {
  return (
    corner === true ||
    (Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0 &&
      Math.min(width, height) <= 160)
  );
}
export function frameInterval(arriving, corner = false, small = false) {
  return 1000 / (corner ? 30 : small ? (arriving ? 24 : 10) : arriving ? 60 : 30);
}
export function ringSummary(n) {
  return growthSummary(n) ?? growthSummary(0);
}
export async function createRelic3D({
  signal,
  archive,
  reducedMotion,
  corner = false,
  framing = 'default',
  previousGrowth = null,
  onReducedMotion = () => {},
  design = DEFAULT_DESIGN,
  load = () => import('/vendor/three.module.js'),
  document: doc = globalThis.document,
  window: win = globalThis.window,
} = {}) {
  let renderer,
    scene,
    camera,
    group,
    canvas,
    disposed = false,
    lost = false,
    frame = null,
    last = -Infinity,
    snapshot = null,
    revision = 0,
    visualSignature = null,
    resumeCalls = 0,
    smallWidget = false,
    staticMode = false,
    lastGrowth = growthSummary(previousGrowth)?.total ?? null;
  const cameraFov = framing === 'film' ? 20 : 36;
  const resources = new Set(),
    sprites = [],
    bands = [];
  const remove = (items) => {
    for (const item of items.splice(0)) {
      group.remove(item);
      scene?.remove?.(item);
      item.geometry?.dispose();
      item.material?.map?.dispose();
      item.material?.dispose();
    }
  };
  const clearMedallion = () => clearGrowthFeedback(archive);
  const growth = (n, feedback = true) => {
    const model = presentGrowth(archive, n) ?? growthSummary(n);
    if (!model) return;
    if (!feedback) {
      clearGrowthFeedback(archive);
      archive.querySelector?.('.growth-tick')?.remove();
    }
    if (feedback && lastGrowth !== null && n > lastGrowth && !reducedMotion.matches) {
      pulseGrowth(archive);
      canvas.dataset.growthTicks = String(Number(canvas.dataset.growthTicks ?? 0) + 1);
      if (archive.ownerDocument?.createElement) {
        archive.querySelector?.('.growth-tick')?.remove();
        const tick = archive.ownerDocument.createElement('span');
        tick.className = 'growth-tick';
        tick.textContent = '+' + String(n - lastGrowth);
        tick.setAttribute('aria-hidden', 'true');
        archive.append(tick);
      }
    }
    lastGrowth = n;
    Object.assign(canvas.dataset, {
      growthTotal: String(n),
      growthTier: model.tier,
      growthTextures: '0',
      growthRepresentation: 'composited-svg-sprite',
      growthSprites: archive.querySelector?.('.growth-fallback') ? '1' : '0',
    });
  };
  const data = (key, value) => {
    if (!canvas) return;
    const text = String(value);
    if (canvas.dataset[key] !== text) canvas.dataset[key] = text;
  };
  const diagnostic = (reason) => {
    if (!canvas) return;
    data('snapshotPresent', Boolean(snapshot));
    data('disposed', disposed);
    data('lost', lost);
    data('documentHidden', Boolean(doc?.hidden));
    data('internalMotion', Boolean(reducedMotion?.matches));
    data('resumeCalls', resumeCalls);
    data('frameScheduled', frame !== null);
    data('resumeReason', reason);
  };
  const fallback = () => {
    if (particles) particles.visible = false;
    if (canvas) canvas.dataset.particlesVisible = 'false';
    archive.classList.remove('webgl-relic');
    if (canvas) {
      canvas.hidden = true;
      if (canvas.style) canvas.style.display = 'none';
    }
  };
  const stop = () => {
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
  };
  let T,
    coreGeometry,
    coreMesh,
    haloMesh,
    particles = null,
    editionId = null;
  const customDesign = design !== DEFAULT_DESIGN;
  const theme = () => (customDesign ? null : selectEdition(Date.now()));
  const rebuildEdition = () => {
    const e = theme(),
      id = e?.id ?? 'base';
    if (id === editionId) return;
    editionId = id;
    if (!customDesign) presentEdition(archive);
    const chosen = e?.design ?? design;
    const mesh = crystalMesh(chosen),
      g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(mesh.positions, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(mesh.colors, 3));
    g.computeVertexNormals();
    if (coreGeometry) {
      resources.delete(coreGeometry);
      coreGeometry.dispose();
    }
    coreGeometry = g;
    resources.add(g);
    if (coreMesh) coreMesh.geometry = g;
    if (haloMesh) haloMesh.geometry = g;
    if (particles) {
      scene.remove(particles);
      resources.delete(particles.geometry);
      resources.delete(particles.material);
      particles.geometry.dispose();
      particles.material.dispose();
      particles = null;
    }
    if (e && T.Points && T.PointsMaterial && e.particles.count) {
      const a = [];
      for (let i = 0; i < e.particles.count; i++) {
        const angle = i * 2.399963,
          r = 1.2 + (i % 7) * 0.055;
        a.push(Math.cos(angle) * r, Math.sin(angle) * r, ((i % 5) - 2) * 0.08);
      }
      const pg = new T.BufferGeometry();
      pg.setAttribute('position', new T.Float32BufferAttribute(a, 3));
      const pm = new T.PointsMaterial({
        color: e.design.palette[3],
        size: 0.035,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        blending: T.AdditiveBlending,
      });
      particles = new T.Points(pg, pm);
      particles.visible = false;
      scene.add(particles);
      resources.add(pg);
      resources.add(pm);
    }
    if (canvas)
      Object.assign(canvas.dataset, {
        edition: id,
        facets: String(chosen.facets),
        particles: String(particles ? e.particles.count : 0),
        coreCount: '1',
      });
  };
  const safely = (fn) => {
    try {
      fn();
    } catch {
      /* Cleanup cannot defeat the SVG fallback. */
    }
  };
  const staticResize = () => {
    if (!disposed && staticMode && snapshot) {
      stop();
      last = -Infinity;
      render(win.performance?.now?.() ?? 0);
    }
  };
  const contextLost = (e) => {
    if (disposed) return;
    e.preventDefault();
    canvas.dataset.contextStatus = 'lost';
    lost = true;
    clearMedallion();
    stop();
    fallback();
    diagnostic('lost');
  };
  const contextRestored = () => {
    if (disposed) return;
    lost = false;
    canvas.dataset.contextStatus = 'active';
    visualSignature = null;
    update(snapshot, { animate: !staticMode });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (canvas) canvas.dataset.disposed = 'true';
    revision++;
    safely(stop);
    safely(fallback);
    safely(() => canvas?.removeEventListener?.('webglcontextlost', contextLost));
    safely(() => canvas?.removeEventListener?.('webglcontextrestored', contextRestored));
    safely(() => win?.removeEventListener?.('resize', staticResize));
    safely(() => doc?.removeEventListener?.('visibilitychange', resume));
    safely(() => reducedMotion?.removeEventListener?.('change', resume));
    safely(() => signal?.removeEventListener?.('abort', dispose));
    if (group) {
      safely(() => remove(sprites));
      safely(() => remove(bands));
    }
    for (const resource of resources) safely(() => resource.dispose?.());
    resources.clear();
    safely(clearMedallion);
    safely(() => archive.querySelector?.('.growth-tick')?.remove());
    safely(() => presentGrowth(archive, undefined));
    safely(() => {
      if (renderer?.debug) renderer.debug.onShaderError = null;
    });
    safely(() => renderer?.dispose?.());
    safely(() => renderer?.forceContextLoss?.());
    safely(() => canvas?.remove?.());
    snapshot = null;
    visualSignature = null;
    coreGeometry = null;
    coreMesh = null;
    haloMesh = null;
    particles = null;
    group = null;
    scene = null;
    camera = null;
    renderer = null;
    canvas = null;
  };
  signal?.addEventListener?.('abort', dispose, { once: true });
  const render = (time) => {
    frame = null;
    if (!disposed && reducedMotion.matches) {
      const count = snapshot?.lineageRings;
      dispose();
      presentGrowth(archive, count);
      onReducedMotion();
      return;
    }
    if (!snapshot || disposed || lost || doc.hidden) {
      fallback();
      diagnostic(
        disposed
          ? 'disposed'
          : lost
            ? 'lost'
            : !snapshot
              ? 'no-snapshot'
              : doc.hidden
                ? 'hidden'
                : 'reduced',
      );
      return;
    }
    const phase = archive.dataset.phase,
      arriving = ['streak', 'impact', 'unfurl'].includes(phase);
    if (time - last >= frameInterval(arriving, corner, smallWidget) - 0.1) {
      const box = archive.getBoundingClientRect(),
        viewport = renderViewport(box.width, box.height);
      smallWidget = lowPowerWidget(box.width, box.height) && !corner;
      if (!viewport) {
        fallback();
        diagnostic('zero-size');
        if (!staticMode) frame = win.requestAnimationFrame(render);
        return;
      }
      if (canvas.width !== viewport.width || canvas.height !== viewport.height) {
        renderer.setSize(viewport.width, viewport.height, false);
        camera.aspect = viewport.aspect;
        camera.updateProjectionMatrix?.();
      } else if (camera.aspect !== viewport.aspect) {
        camera.aspect = viewport.aspect;
        camera.updateProjectionMatrix?.();
      }
      data('viewportWidth', viewport.width);
      data('viewportHeight', viewport.height);
      data('projectionAspect', viewport.aspect);
      rebuildEdition();
      if (particles) {
        particles.visible = arriving;
        particles.rotation.z = time * 0.00006;
      }
      data('particlesVisible', Boolean(particles?.visible));
      last = time;
      group.rotation.y = time * 0.00018;
      group.rotation.z = Math.sin(time * 0.00013) * 0.06;
      for (let i = 0; i < bands.length; i++) bands[i].rotation.z = time * 0.0001 * (i % 2 ? 1 : -1);
      const unfurl =
        phase === 'unfurl'
          ? Number.parseFloat(archive.style?.getPropertyValue('--arrival') ?? '1')
          : 1;
      for (const sprite of sprites) {
        const pose = runePose(sprite.orbitIndex, snapshot.marks?.length ?? 0, time, unfurl);
        sprite.visible =
          !['streak', 'impact'].includes(phase) && (phase !== 'unfurl' || pose.flight > 0);
        const span = 2 * (6 - 0.5) * Math.tan((cameraFov * Math.PI) / 360);
        sprite.position.set(
          ((pose.x - 50) / 100) * span * camera.aspect,
          ((50 - pose.y) / 100) * span,
          0.5,
        );
      }
      const fusionWait = archive.dataset.fusionPending === 'true';
      const fusionProgress = fusionWait
        ? Number(archive.style?.getPropertyValue('--p3-fusion') ?? '1')
        : 1;
      const newestIndex = Math.floor(bands.length / 2) - 1;
      const fusionFlare = fusionWait
        ? Math.max(0, Math.min(1, Number(archive.style?.getPropertyValue('--fusion-glow') ?? '0')))
        : 0;
      for (const band of bands) {
        const newest = band.ringIndex === newestIndex;
        const visible = !newest || !fusionWait || fusionProgress > 0;
        if (band.visible !== visible) band.visible = visible;
        const flare = newest ? fusionFlare : 0;
        if (band.lastFlare !== flare) {
          const [r, g, b] = band.baseRGB;
          band.material.color?.setRGB?.(
            r + flare * (1 - r),
            g + flare * (0.917 - g),
            b + flare * (0.784 - b),
          );
          band.lastFlare = flare;
        }
        const scale = newest && fusionWait ? 0.7 + 0.3 * fusionProgress : 1;
        if (band.lastScale !== scale) {
          band.scale?.setScalar?.(scale);
          band.lastScale = scale;
        }
      }
      try {
        renderer.render(scene, camera);
        if (lost) {
          fallback();
          diagnostic('lost');
          return;
        }
        data('triangles', renderer.info?.render?.triangles ?? 0);
        // Opt-in local diagnostic sampling; no extra draw, history or provider data.
        if (canvas.hasAttribute?.('data-render-profile')) {
          data('drawCalls', renderer.info?.render?.calls ?? 0);
          data('textureCount', renderer.info?.memory?.textures ?? 0);
          data('geometryCount', renderer.info?.memory?.geometries ?? 0);
        }
        data('sprites', sprites.length);
        data('fps', Math.round(1000 / frameInterval(arriving, corner, smallWidget)));
        canvas.dataset.fadedSprites = String(
          sprites.filter((s) => s.material.opacity === 0.28).length,
        );
        canvas.dataset.frames = String(Number(canvas.dataset.frames ?? 0) + 1);
        if (canvas.hidden) canvas.hidden = false;
        if (canvas.style && canvas.style.display !== 'block') canvas.style.display = 'block';
        if (!archive.classList.contains?.('webgl-relic')) archive.classList.add('webgl-relic');
        if (canvas.hasAttribute?.('data-pixel-probe'))
          canvas.dispatchEvent(new Event('relic3d-frame'));
      } catch (error) {
        canvas.dataset.renderError = ['TypeError', 'RangeError', 'Error'].includes(error?.name)
          ? error.name
          : 'OtherError';
        lost = true;
        fallback();
        diagnostic('lost');
        return;
      }
    }
    if (!staticMode) frame = win.requestAnimationFrame(render);
    diagnostic(staticMode ? 'static' : 'animating');
  };
  const resume = () => {
    if (disposed) return;
    if (reducedMotion.matches) {
      const count = snapshot?.lineageRings;
      dispose();
      presentGrowth(archive, count);
      onReducedMotion();
      return;
    }
    resumeCalls++;
    const blocked = disposed
      ? 'disposed'
      : lost
        ? 'lost'
        : !snapshot
          ? 'no-snapshot'
          : doc.hidden
            ? 'hidden'
            : reducedMotion.matches
              ? 'reduced'
              : null;
    if (blocked) {
      stop();
      fallback();
      diagnostic(blocked);
      return;
    }
    if (frame === null) {
      last = -Infinity;
      frame = win.requestAnimationFrame(render);
      diagnostic('scheduled');
    } else diagnostic('already-scheduled');
  };
  try {
    if (signal?.aborted || reducedMotion.matches) {
      dispose();
      return {
        update(value) {
          presentGrowth(archive, value?.lineageRings);
        },
        wake() {},
        dispose() {
          presentGrowth(archive, undefined);
        },
        available: false,
      };
    }
    T = await load();
    if (disposed || signal?.aborted) {
      dispose();
      return {
        update(value) {
          presentGrowth(archive, value?.lineageRings);
        },
        wake() {},
        dispose() {
          presentGrowth(archive, undefined);
        },
        available: false,
      };
    }
    const initialBox = archive.getBoundingClientRect(),
      antialias = !lowPowerWidget(initialBox.width, initialBox.height, corner);
    renderer = new T.WebGLRenderer({ alpha: true, antialias, powerPreference: 'low-power' });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0, 0);
    if (renderer.debug)
      renderer.debug.onShaderError = () => {
        if (canvas)
          canvas.dataset.shaderErrors = String(Number(canvas.dataset.shaderErrors ?? 0) + 1);
        lost = true;
        stop();
        fallback();
        diagnostic('lost');
      };
    canvas = renderer.domElement;
    canvas.className = 'relic3d';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.hidden = true;
    if (canvas.style) canvas.style.display = 'none';
    canvas.dataset.antialiasRequested = String(antialias);
    canvas.dataset.contextStatus = 'active';
    canvas.dataset.shaderErrors = '0';
    archive.append(canvas);
    scene = new T.Scene();
    // Film-only close framing; all existing callers retain the 36-degree camera.
    camera = new T.PerspectiveCamera(cameraFov, 1, 0.1, 20);
    camera.position.z = 6;
    group = new T.Group();
    scene.add(group);
    const geometry = new T.BufferGeometry();
    coreGeometry = geometry;
    resources.add(geometry);
    const material = new T.ShaderMaterial({
      vertexColors: true,
      transparent: true,
      // Near-opaque faceted metal needs one double-sided draw, not a separate
      // back-face transparent pass. Keep the same shader, depth and geometry.
      forceSinglePass: true,
      side: T.DoubleSide,
      vertexShader:
        'varying vec3 tint; varying vec3 norm; varying vec3 eye; void main(){ tint=color; vec4 p=modelViewMatrix*vec4(position,1.0); norm=normalize(normalMatrix*normal); eye=normalize(-p.xyz); gl_Position=projectionMatrix*p; }',
      fragmentShader:
        'varying vec3 tint; varying vec3 norm; varying vec3 eye; void main(){ vec3 N=normalize(norm); vec3 E=normalize(eye); const vec3 L=normalize(vec3(-.5,.8,1.0)); float rim=1.0-abs(dot(N,E)); float f=rim*rim; vec3 moon=mix(vec3(.70,.63,.84),vec3(.86,.90,.94),f); float x=max(0.0,dot(reflect(-E,N),L)); float x2=x*x; float x4=x2*x2; float shine=x4*x4*x4; vec3 metal=tint*(.65+.35*abs(norm.y)) + moon*(f*1.25+shine*.85); gl_FragColor=vec4(metal,.98); }',
    });
    coreMesh = new T.Mesh(geometry, material);
    group.add(coreMesh);
    resources.add(material);
    // A translucent, additive expanded faceted shell: no opaque quad/postprocess.
    const haloMaterial = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: T.BackSide,
      blending: T.AdditiveBlending,
      vertexShader:
        'varying vec3 n; varying vec3 e; void main(){ vec4 p=modelViewMatrix*vec4(position*1.14,1.0); n=normalize(normalMatrix*normal); e=normalize(-p.xyz); gl_Position=projectionMatrix*p; }',
      fragmentShader:
        'varying vec3 n; varying vec3 e; void main(){ vec3 N=normalize(n); vec3 E=normalize(e); float edge=1.0-abs(dot(N,E)); float rim=edge*edge; gl_FragColor=vec4(vec3(.58,.70,1.0),rim*.42); }',
    });
    haloMesh = new T.Mesh(geometry, haloMaterial);
    group.add(haloMesh);
    resources.add(haloMaterial);
    rebuildEdition();
    // Procedural soft aura, not postprocessed bloom. Two triangles, no asset fetch.
    const auraTile = doc?.createElement?.('canvas');
    const auraContext = auraTile?.getContext?.('2d');
    if (T.CanvasTexture && auraContext?.createRadialGradient) {
      auraTile.width = auraTile.height = 128;
      const glow = auraContext.createRadialGradient(64, 64, 10, 64, 64, 64);
      glow.addColorStop(0, 'rgba(199,237,250,0.20)');
      glow.addColorStop(0.4, 'rgba(148,134,183,0.12)');
      glow.addColorStop(1, 'rgba(148,134,183,0)');
      auraContext.fillStyle = glow;
      auraContext.fillRect(0, 0, 128, 128);
      const texture = new T.CanvasTexture(auraTile);
      const auraMaterial = new T.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
      });
      const aura = new T.Sprite(auraMaterial);
      aura.scale.set(3.5, 3.5, 1);
      aura.position.z = -0.5;
      scene.add(aura);
      resources.add(texture);
      resources.add(auraMaterial);
    }
    canvas.addEventListener('webglcontextlost', contextLost);
    canvas.addEventListener('webglcontextrestored', contextRestored);
    win?.addEventListener?.('resize', staticResize);
    doc?.addEventListener?.('visibilitychange', resume);
    reducedMotion?.addEventListener?.('change', resume);
    resume();
  } catch {
    dispose();
    return {
      update(value) {
        presentGrowth(archive, value?.lineageRings);
      },
      wake() {},
      dispose() {
        presentGrowth(archive, undefined);
      },
      available: false,
    };
  }
  function update(value, { animate = true, growthFeedback = true } = {}) {
    if (disposed) return;
    if (reducedMotion.matches) {
      const count = growthSummary(value?.lineageRings)?.total;
      dispose();
      presentGrowth(archive, count);
      onReducedMotion();
      return;
    }
    if (value && !growthSummary(value.lineageRings)) value = null;
    snapshot = value;
    presentGrowth(archive, value?.lineageRings);
    staticMode = Boolean(value) && animate === false;
    const signature = snapshot
      ? JSON.stringify([
          staticMode,
          snapshot.lineageRings,
          snapshot.status ?? 'preview',
          (snapshot.marks ?? [])
            .slice(0, 160)
            .map((m) => [m.id ?? '', m.runeSvg, m.faded === true]),
        ])
      : null;
    if (!growthFeedback) {
      clearGrowthFeedback(archive);
      archive.querySelector?.('.growth-tick')?.remove();
    }
    if (signature !== null && signature === visualSignature) {
      diagnostic('unchanged');
      return;
    }
    visualSignature = signature;
    const ownRevision = ++revision;
    remove(sprites);
    remove(bands);
    if (!snapshot) {
      clearMedallion();
      archive.querySelector?.('.growth-tick')?.remove();
      if (canvas) {
        canvas.dataset.bands = '0';
        canvas.dataset.sprites = '0';
      }
      fallback();
      stop();
      diagnostic('no-snapshot');
      return;
    }
    growth(snapshot.lineageRings, growthFeedback);
    const summary = ringSummary(snapshot.lineageRings),
      rings = summary.visible;
    for (let i = 0; i < rings; i++) {
      // 2 toruses *16 rings *8*24*2 triangles =12,288; core+halo<=144,
      // 160 sprites<=320: total comfortably below20k.
      for (const orbit of [false, true]) {
        const geometry = new T.TorusGeometry(
          1.05 + i * 0.018,
          summary.groups[i] >= 10 ? (orbit ? 0.015 : 0.03) : orbit ? 0.008 : 0.013,
          corner ? 3 : 8,
          corner ? 16 : 24,
        );
        const material = new T.MeshBasicMaterial({
          color: summary.groups[i] >= 10 ? summary.color : '#d8b46a',
          transparent: true,
          opacity: orbit ? 0.45 : 0.7,
        });
        const band = new T.Mesh(geometry, material);
        band.rotation.x = orbit ? 0.7 + i * 0.04 : 0;
        band.rotation.y = orbit ? 0.25 : 0;
        band.ringIndex = i;
        // Preserve Three's linear-space tier color; never overwrite it with a
        // fixed gold value on every frame. Only the newest fusion band flares.
        band.baseRGB = [
          material.color?.r ?? 0.835,
          material.color?.g ?? 0.667,
          material.color?.b ?? 0.384,
        ];
        band.lastFlare = 0;
        band.lastScale = 1;
        bands.push(band);
        scene.add(band);
      }
    }
    if (canvas) {
      canvas.dataset.bands = String(bands.length);
      canvas.dataset.physicalBands = String(summary.visible);
      canvas.dataset.bandUnits = JSON.stringify(summary.groups);
    }
    let spriteFailures = 0;
    if (canvas) canvas.dataset.spriteFailures = '0';
    for (const [index, mark] of (snapshot.marks ?? []).slice(0, 160).entries()) {
      // Only the already validated public canonical SVG projection is used.
      const image = new win.Image();
      image.onload = () => {
        if (disposed || ownRevision !== revision || lost) return;
        let texture;
        const tile = doc?.createElement?.('canvas');
        const ctx = tile?.getContext?.('2d');
        if (ctx && T.CanvasTexture) {
          tile.width = tile.height = 128;
          ctx.clearRect(0, 0, 128, 128);
          ctx.shadowColor = '#c7edfa';
          ctx.shadowBlur = 12;
          ctx.drawImage(image, 20, 20, 88, 88);
          ctx.shadowBlur = 0;
          ctx.drawImage(image, 20, 20, 88, 88);
          texture = new T.CanvasTexture(tile);
        } else texture = new T.Texture(image);
        if (T.SRGBColorSpace) texture.colorSpace = T.SRGBColorSpace;
        texture.needsUpdate = true;
        const material = new T.SpriteMaterial({
          map: texture,
          transparent: true,
          opacity: mark.faded === true ? 0.28 : 1,
          depthWrite: false,
          depthTest: false,
        });
        const sprite = new T.Sprite(material);
        sprite.orbitIndex = index;
        sprite.renderOrder = 10;
        sprite.scale.set(corner ? 0.65 : 0.48, corner ? 0.65 : 0.48, 1);
        sprites.push(sprite);
        sprites.sort((a, b) => a.orbitIndex - b.orbitIndex);
        scene.add(sprite);
      };
      image.onerror = () => {
        if (!disposed && ownRevision === revision && !lost)
          canvas.dataset.spriteFailures = String(++spriteFailures);
      };
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mark.runeSvg)}`;
    }
    if (staticMode) {
      stop();
      last = -Infinity;
      render(win.performance?.now?.() ?? 0);
    } else resume();
  }
  return {
    available: true,
    update,
    ringInset() {
      const rings = ringSummary(snapshot?.lineageRings).visible;
      return 50 - ((1.05 + Math.max(0, rings - 1) * 0.018) / (12 * Math.tan(Math.PI / 10))) * 100;
    },
    wake: resume,
    dispose,
  };
}
