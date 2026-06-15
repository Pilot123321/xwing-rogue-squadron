/**
 * Procedurally-modeled TIE/ln fighter: a spherical command pod flanked by two
 * hexagonal solar-collector wing panels on struts. Nose toward -Z. No assets.
 */

import * as THREE from "three";

const POD = new THREE.MeshStandardMaterial({ color: 0x6a6f77, metalness: 0.5, roughness: 0.5 });
const PANEL = new THREE.MeshStandardMaterial({ color: 0x202327, metalness: 0.4, roughness: 0.6, side: THREE.DoubleSide });
const STRUT = new THREE.MeshStandardMaterial({ color: 0x35393f, metalness: 0.6, roughness: 0.4 });
const EYE = new THREE.MeshBasicMaterial({ color: 0x101418 });

/** Build a fresh TIE fighter group (each enemy gets its own instance). */
export function buildTIE(): THREE.Group {
  const g = new THREE.Group();

  // Command pod (ball cockpit).
  const pod = new THREE.Mesh(new THREE.SphereGeometry(1.6, 28, 18), POD);
  g.add(pod);

  // Window/eye plate on the front (-Z).
  const eye = new THREE.Mesh(new THREE.CircleGeometry(1.0, 18), EYE);
  eye.position.z = -1.55;
  g.add(eye);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.12, 14, 32), STRUT);
  ring.position.z = -1.5;
  g.add(ring);

  // Two hexagonal wing panels via a 6-sided cylinder squashed flat.
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.0, 16), STRUT);
    strut.rotation.z = Math.PI / 2;
    strut.position.set(side * 1.8, 0, 0);
    g.add(strut);

    const panel = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.25, 6), PANEL);
    panel.rotation.z = Math.PI / 2; // face sideways
    panel.rotation.x = Math.PI / 2;
    panel.position.set(side * 3.4, 0, 0);
    g.add(panel);

    // radial spar detail across the panel.
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 6.4, 0.3), STRUT);
    spar.position.set(side * 3.4, 0, 0);
    g.add(spar);
    const spar2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 6.4), STRUT);
    spar2.position.set(side * 3.4, 0, 0);
    g.add(spar2);
  }

  return g;
}
