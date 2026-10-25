import { runePose } from './cinematic.js';
// Original procedural renderer. The reviewed local Three.js vendor is optional;
// failed imports, reduced motion and context loss retain the original SVG.
export const DEFAULT_DESIGN = Object.freeze({ version: 1, shape: 'crystal', facets: 6, aspect: 1, palette: ['#101d30', '#dce4ed', '#9486b7', '#c7edfa'] });
export function validRelicDesign(d) {
  return d && Object.keys(d).sort().join(',') === 'aspect,facets,palette,shape,version' && d.version === 1
    && ['crystal', 'orb', 'seed'].includes(d.shape) && Number.isInteger(d.facets) && d.facets >= 3 && d.facets <= 12
    && Number.isFinite(d.aspect) && d.aspect >= .6 && d.aspect <= 1.6
    && Array.isArray(d.palette) && d.palette.length === 4 && d.palette.every(c => /^#[0-9a-f]{6}$/.test(c));
}
export function crystalMesh(design = DEFAULT_DESIGN) {
  if (!validRelicDesign(design)) throw Error('Invalid relic design');
  const positions = [], colors = [];
  const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255);
  const radius = design.shape === 'orb' ? .68 : design.shape === 'seed' ? .5 : .6;
  const levels = [[-1, 0], [-.35, radius * .78], [.15, radius], [.6, radius * .58], [1, 0]];
  const point = (i, level) => { const angle = i * Math.PI * 2 / design.facets; return [Math.cos(angle) * level[1], level[0] * design.aspect, Math.sin(angle) * level[1]]; };
  const triangle = (vertices, color) => { positions.push(...vertices.flat()); for (let v = 0; v < 3; v++) colors.push(...rgb(color)); };
  for (let layer = 0; layer < levels.length - 1; layer++) for (let i = 0; i < design.facets; i++) {
    const a = point(i, levels[layer]), b = point(i + 1, levels[layer]);
    const c = point(i, levels[layer + 1]), d = point(i + 1, levels[layer + 1]);
    const tint = design.palette[1 + (i + layer) % 3];
    if (levels[layer][1] !== 0) triangle([a, b, c], tint);
    if (levels[layer + 1][1] !== 0) triangle([b, d, c], tint);
  }
  return { positions, colors, triangles: positions.length / 9 };
}
export function frameInterval(arriving, corner = false) { return 1000 / (arriving && !corner ? 60 : 30); }
export function ringSummary(n) { const total = Number.isInteger(n) && n > 0 ? n : 0; return { total, visible: Math.min(16, total), text: total > 16 ? `${total} completed rings · 16 visual bands shown` : `${total} completed growth rings` }; }
export async function createRelic3D({ signal, archive, reducedMotion, corner = false, design = DEFAULT_DESIGN,
  load = () => import('/vendor/three.module.js'), document: doc = globalThis.document, window: win = globalThis.window } = {}) {
  let renderer, scene, camera, group, canvas, disposed = false, lost = false, frame = null, last = -Infinity, snapshot = null, revision = 0, visualSignature = null, resumeCalls = 0;
  const resources = new Set(), sprites = [], bands = [];
  const remove = items => { for (const item of items.splice(0)) { group.remove(item); scene?.remove?.(item); item.geometry?.dispose(); item.material?.map?.dispose(); item.material?.dispose(); } };
  const diagnostic = reason => {
    if (!canvas) return;
    Object.assign(canvas.dataset, { snapshotPresent: String(Boolean(snapshot)), disposed: String(disposed), lost: String(lost),
      documentHidden: String(Boolean(doc?.hidden)), internalMotion: String(Boolean(reducedMotion?.matches)),
      resumeCalls: String(resumeCalls), frameScheduled: String(frame !== null), resumeReason: reason });
  };
  const fallback = () => { archive.classList.remove('webgl-relic'); if (canvas) canvas.hidden = true; };
  const stop = () => { if (frame !== null) win.cancelAnimationFrame(frame); frame = null; };
  let T;
  const safely = fn => { try { fn(); } catch { /* Cleanup cannot defeat the SVG fallback. */ } };
  const dispose = () => { if (disposed) return; disposed = true; revision++; safely(stop); safely(fallback); safely(() => doc?.removeEventListener?.('visibilitychange', resume)); safely(() => reducedMotion?.removeEventListener?.('change', resume)); safely(() => signal?.removeEventListener?.('abort', dispose)); if (group) { safely(() => remove(sprites)); safely(() => remove(bands)); } for (const resource of resources) safely(() => resource.dispose?.()); safely(() => renderer?.dispose?.()); safely(() => canvas?.remove?.()); };
  signal?.addEventListener?.('abort', dispose, { once: true });
  const render = time => {
    frame = null;
    if (!snapshot || disposed || lost || doc.hidden || reducedMotion.matches) { fallback(); diagnostic(disposed ? 'disposed' : lost ? 'lost' : !snapshot ? 'no-snapshot' : doc.hidden ? 'hidden' : 'reduced'); return; }
    const phase = archive.dataset.phase, arriving = ['streak', 'impact', 'unfurl'].includes(phase);
    if (time - last >= frameInterval(arriving, corner) - .1) {
      last = time; group.rotation.y = time * .00018; group.rotation.z = Math.sin(time * .00013) * .06;
      for (let i = 0; i < bands.length; i++) bands[i].rotation.z = time * .0001 * (i % 2 ? 1 : -1);
      const unfurl = phase === 'unfurl' ? Number.parseFloat(archive.style?.getPropertyValue('--arrival') ?? '1') : 1;
      for (const sprite of sprites) {
        const pose = runePose(sprite.orbitIndex, snapshot.marks?.length ?? 0, time, unfurl);
        sprite.visible = !['streak', 'impact'].includes(phase) && (phase !== 'unfurl' || pose.flight > 0);
        const span = 2 * (6 - .5) * Math.tan(Math.PI / 10); // camera36deg, sprite plane z=.5
        sprite.position.set((pose.x - 50) / 100 * span, (50 - pose.y) / 100 * span, .5);
      }
      const fusionWait = archive.dataset.fusionPending === 'true';
      const fusionProgress = Number(archive.style?.getPropertyValue('--p3-fusion') ?? '1');
      for (const band of bands) {
        const newest = band.ringIndex === ringSummary(snapshot.lineageRings).visible - 1;
        band.visible = !newest || !fusionWait || fusionProgress > 0;
        const flare = newest && fusionWait ? Math.max(0,Math.min(1,Number(archive.style?.getPropertyValue('--fusion-glow')??'0'))) : 0;
        band.material.color?.setRGB?.(.835 + flare*.165, .667 + flare*.25, .384 + flare*.40);

        if (band.scale?.setScalar) band.scale.setScalar(newest && fusionWait ? .7 + .3 * fusionProgress : 1);
      }
      const box = archive.getBoundingClientRect(); const size = Math.max(1, Math.min(480, Math.round(box.width)));
      if (canvas.width !== size) renderer.setSize(size, size, false);
      try { renderer.render(scene, camera); if (lost) { fallback(); diagnostic('lost'); return; } canvas.dataset.triangles = String(renderer.info?.render?.triangles ?? 0); canvas.dataset.sprites = String(sprites.length); canvas.dataset.fps = String(arriving && !corner ? 60 : 30); canvas.dataset.fadedSprites = String(sprites.filter(s => s.material.opacity === .28).length); canvas.dataset.frames = String(Number(canvas.dataset.frames ?? 0) + 1); canvas.hidden = false; archive.classList.add('webgl-relic'); if (canvas.hasAttribute?.('data-pixel-probe')) canvas.dispatchEvent(new Event('relic3d-frame')); } catch (error) { canvas.dataset.renderError = ['TypeError','RangeError','Error'].includes(error?.name) ? error.name : 'OtherError'; lost = true; fallback(); diagnostic('lost'); return; }
    }
    frame = win.requestAnimationFrame(render); diagnostic('animating');
  };
  const resume = () => {
    resumeCalls++;
    const blocked = disposed ? 'disposed' : lost ? 'lost' : !snapshot ? 'no-snapshot' : doc.hidden ? 'hidden' : reducedMotion.matches ? 'reduced' : null;
    if (blocked) { stop(); fallback(); diagnostic(blocked); return; }
    if (frame === null) { last = -Infinity; frame = win.requestAnimationFrame(render); diagnostic('scheduled'); }
    else diagnostic('already-scheduled');
  };
  try {
    if (signal?.aborted || reducedMotion.matches) { dispose(); return { update() {}, wake() {}, dispose() {}, available: false }; }
    T = await load(); if (disposed || signal?.aborted) { dispose(); return { update() {}, wake() {}, dispose() {}, available: false }; }
    renderer = new T.WebGLRenderer({ alpha: true, antialias: !corner, powerPreference: 'low-power' }); renderer.setPixelRatio(1); renderer.setClearColor(0, 0);
    if (renderer.debug) renderer.debug.onShaderError = () => { if (canvas) canvas.dataset.shaderErrors = String(Number(canvas.dataset.shaderErrors ?? 0) + 1); lost = true; stop(); fallback(); diagnostic('lost'); };
    canvas = renderer.domElement; canvas.className = 'relic3d'; canvas.setAttribute('aria-hidden', 'true'); canvas.hidden = true; canvas.dataset.contextStatus = 'active'; canvas.dataset.shaderErrors = '0'; archive.append(canvas);
    scene = new T.Scene(); camera = new T.PerspectiveCamera(36, 1, .1, 20); camera.position.z = 6;
    group = new T.Group(); scene.add(group);
    const mesh = crystalMesh(design), geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(mesh.positions, 3)); geometry.setAttribute('color', new T.Float32BufferAttribute(mesh.colors, 3)); geometry.computeVertexNormals();
    const material = new T.ShaderMaterial({ vertexColors: true, transparent: true, side: T.DoubleSide,
      vertexShader: 'varying vec3 tint; varying vec3 norm; varying vec3 eye; void main(){ tint=color; vec4 p=modelViewMatrix*vec4(position,1.0); norm=normalize(normalMatrix*normal); eye=normalize(-p.xyz); gl_Position=projectionMatrix*p; }',
      fragmentShader: 'varying vec3 tint; varying vec3 norm; varying vec3 eye; void main(){ float f=pow(1.0-abs(dot(normalize(norm),normalize(eye))),2.0); vec3 moon=mix(vec3(.70,.63,.84),vec3(.86,.90,.94),f); float shine=pow(max(0.0,dot(reflect(-normalize(eye),normalize(norm)),normalize(vec3(-.5,.8,1.0)))),12.0); vec3 metal=tint*(.65+.35*abs(norm.y)) + moon*(f*1.25+shine*.85); gl_FragColor=vec4(metal,.98); }' });
    group.add(new T.Mesh(geometry, material)); resources.add(geometry); resources.add(material);
    // A translucent, additive expanded faceted shell: no opaque quad/postprocess.
    const haloMaterial = new T.ShaderMaterial({ transparent: true, depthWrite: false, side: T.BackSide, blending: T.AdditiveBlending,
      vertexShader: 'varying vec3 n; varying vec3 e; void main(){ vec4 p=modelViewMatrix*vec4(position*1.14,1.0); n=normalize(normalMatrix*normal); e=normalize(-p.xyz); gl_Position=projectionMatrix*p; }',
      fragmentShader: 'varying vec3 n; varying vec3 e; void main(){ float rim=pow(1.0-abs(dot(normalize(n),normalize(e))),2.0); gl_FragColor=vec4(vec3(.58,.70,1.0),rim*.42); }' });
    group.add(new T.Mesh(geometry, haloMaterial)); resources.add(haloMaterial);
    // Procedural soft aura, not postprocessed bloom. Two triangles, no asset fetch.
    const auraTile = doc?.createElement?.('canvas'); const auraContext = auraTile?.getContext?.('2d');
    if (T.CanvasTexture && auraContext?.createRadialGradient) {
      auraTile.width = auraTile.height = 128;
      const glow = auraContext.createRadialGradient(64, 64, 10, 64, 64, 64);
      glow.addColorStop(0, 'rgba(199,237,250,0.20)'); glow.addColorStop(.4, 'rgba(148,134,183,0.12)'); glow.addColorStop(1, 'rgba(148,134,183,0)');
      auraContext.fillStyle = glow; auraContext.fillRect(0, 0, 128, 128);
      const texture = new T.CanvasTexture(auraTile);
      const auraMaterial = new T.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, blending: T.AdditiveBlending });
      const aura = new T.Sprite(auraMaterial); aura.scale.set(3.5, 3.5, 1); aura.position.z = -.5; scene.add(aura);
      resources.add(texture); resources.add(auraMaterial);
    }
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); canvas.dataset.contextStatus = 'lost'; lost = true; stop(); fallback(); diagnostic('lost'); });
    doc?.addEventListener?.('visibilitychange', resume); reducedMotion?.addEventListener?.('change', resume); resume();
  } catch { dispose(); return { update() {}, wake() {}, dispose() {}, available: false }; }
  return {
    available: true,
    update(value) {
      if (disposed) return;
      snapshot = value;
      const signature = snapshot ? JSON.stringify([ringSummary(snapshot.lineageRings).visible, snapshot.status ?? 'preview',
        (snapshot.marks ?? []).slice(0, 160).map(m => [m.id ?? '', m.runeSvg, m.faded === true])]) : null;
      if (signature !== null && signature === visualSignature) { diagnostic('unchanged'); return; }
      visualSignature = signature; const ownRevision = ++revision; remove(sprites); remove(bands);
      if (!snapshot) { fallback(); stop(); diagnostic('no-snapshot'); return; }
      const rings = ringSummary(snapshot.lineageRings).visible;
      for (let i = 0; i < rings; i++) {
        // 2 toruses *16 rings *8*24*2 triangles =12,288; core+halo<=144,
        // 160 sprites<=320: total comfortably below20k.
        for (const orbit of [false, true]) {
          const geometry = new T.TorusGeometry(1.05 + i * .018, orbit ? .008 : .013, corner ? 3 : 8, corner ? 16 : 24);
          const material = new T.MeshBasicMaterial({ color: '#d5aa62', transparent: true, opacity: orbit ? .45 : .7 });
          const band = new T.Mesh(geometry, material); band.rotation.x = orbit ? .7 + i * .04 : 0; band.rotation.y = orbit ? .25 : 0; band.ringIndex = i; bands.push(band); scene.add(band);
        }
      }
      if (canvas) canvas.dataset.bands = String(bands.length);
      let spriteFailures = 0;
      if (canvas) canvas.dataset.spriteFailures = '0';
      for (const [index, mark] of (snapshot.marks ?? []).slice(0, 160).entries()) {
        // Only the already validated public canonical SVG projection is used.
        const image = new win.Image(); image.onload = () => {
          if (disposed || ownRevision !== revision || lost) return;
          let texture;
          const tile = doc?.createElement?.('canvas'); const ctx = tile?.getContext?.('2d');
          if (ctx && T.CanvasTexture) {
            tile.width = tile.height = 128; ctx.clearRect(0, 0, 128, 128);
            ctx.shadowColor = '#c7edfa'; ctx.shadowBlur = 12; ctx.drawImage(image, 20, 20, 88, 88);
            ctx.shadowBlur = 0; ctx.drawImage(image, 20, 20, 88, 88); texture = new T.CanvasTexture(tile);
          } else texture = new T.Texture(image);
          if (T.SRGBColorSpace) texture.colorSpace = T.SRGBColorSpace; texture.needsUpdate = true;
          const material = new T.SpriteMaterial({ map: texture, transparent: true, opacity: mark.faded === true ? .28 : 1, depthWrite: false, depthTest: false });
          const sprite = new T.Sprite(material); sprite.orbitIndex = index; sprite.renderOrder = 10; sprite.scale.set(corner ? .65 : .48, corner ? .65 : .48, 1); sprites.push(sprite); sprites.sort((a, b) => a.orbitIndex - b.orbitIndex); scene.add(sprite);
        }; image.onerror = () => { if (!disposed && ownRevision === revision && !lost) canvas.dataset.spriteFailures = String(++spriteFailures); }; image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mark.runeSvg)}`;
      }
      resume();
    },
    ringInset() { const rings = ringSummary(snapshot?.lineageRings).visible; return 50 - (1.05 + Math.max(0, rings - 1) * .018) / (12 * Math.tan(Math.PI / 10)) * 100; },
    wake: resume,
    dispose
  };
}
