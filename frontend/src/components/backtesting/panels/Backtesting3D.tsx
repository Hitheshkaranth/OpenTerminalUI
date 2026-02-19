import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { terminalColors } from "../../../theme/terminal";

export type Surface3DPoint = {
  x: number;
  y: number;
  z: number;
  color?: string;
};

type ThreeDSurfaceProps = {
  points: Surface3DPoint[];
  emptyText: string;
};

function hexColor(input: string): number {
  return Number.parseInt(input.replace("#", "0x"), 16);
}

export function ThreeDSurface({ points, emptyText }: ThreeDSurfaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const normalized = useMemo(() => {
    if (!points.length) return [];
    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    const minZ = Math.min(...points.map((p) => p.z));
    const maxZ = Math.max(...points.map((p) => p.z));
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const spanZ = maxZ - minZ || 1;
    return points.map((p) => ({
      x: ((p.x - minX) / spanX) * 10 - 5,
      y: ((p.y - minY) / spanY) * 10 - 5,
      z: ((p.z - minZ) / spanZ) * 2 - 1,
      color: p.color,
    }));
  }, [points]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !normalized.length) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(hexColor(terminalColors.bg));

    const camera = new THREE.PerspectiveCamera(45, Math.max(host.clientWidth, 1) / Math.max(host.clientHeight, 1), 0.1, 1000);
    camera.position.set(12, 11, 13);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);

    const root = new THREE.Group();
    scene.add(root);

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(8, 10, 6);
    scene.add(ambient);
    scene.add(dir);

    const grid = new THREE.GridHelper(12, 12, hexColor(terminalColors.border), hexColor(terminalColors.border));
    (grid.material as THREE.Material).opacity = 0.35;
    (grid.material as THREE.Material).transparent = true;
    root.add(grid);

    for (const point of normalized) {
      const h = Math.max(0.15, Math.abs(point.z) * 2.8);
      const color = point.color ?? (point.z >= 0 ? terminalColors.positive : terminalColors.negative);
      const geom = new THREE.BoxGeometry(0.7, h, 0.7);
      const mat = new THREE.MeshStandardMaterial({
        color: hexColor(color),
        roughness: 0.45,
        metalness: 0.2,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(point.x, h / 2, point.y);
      root.add(mesh);
    }

    const animate = () => {
      root.rotation.y += 0.0035;
      renderer.render(scene, camera);
      frameRef.current = window.requestAnimationFrame(animate);
    };
    animate();

    const ro = new ResizeObserver(() => {
      if (!host) return;
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
      renderer.dispose();
      host.removeChild(renderer.domElement);
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
    };
  }, [normalized]);

  if (!points.length) {
    return (
      <div className="flex h-[44vh] min-h-[280px] items-center justify-center rounded border border-terminal-border/40 bg-terminal-bg/50 text-center">
        <div className="text-xs text-terminal-muted">{emptyText}</div>
      </div>
    );
  }

  return <div ref={hostRef} className="h-[44vh] min-h-[280px] w-full rounded border border-terminal-border/40 bg-terminal-bg/70" />;
}
