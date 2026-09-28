import type { Coords, Location } from "@sns-conv/schema";
import type { FeatureCollection, Point } from "geojson";
import maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { Theme } from "../theme";

const STYLES: Record<Theme, string> = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};
const PT_CENTER: [number, number] = [-8.6, 39.6];

interface Props {
  locations: Location[];
  origin: Coords | null;
  theme: Theme;
  highlightId?: number | null;
  onSelect?: (id: number) => void;
  onHover?: (id: number | null) => void;
  fitOnChange?: boolean;
  className?: string;
}

function toGeoJson(locations: Location[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: locations
      .filter((l) => l.coords)
      .map((l) => ({
        type: "Feature",
        id: l.id,
        geometry: { type: "Point", coordinates: [l.coords!.lon, l.coords!.lat] },
        properties: { id: l.id, name: l.name },
      })),
  };
}

/** Mapa MapLibre. Muda de estilo com o tema; o pai remonta o componente via `key`. */
export function MapView({
  locations,
  origin,
  theme,
  highlightId,
  onSelect,
  onHover,
  fitOnChange = true,
  className,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const originMarker = useRef<maplibregl.Marker | null>(null);
  const prevHl = useRef<number | null>(null);
  const accent = theme === "dark" ? "#2997ff" : "#0066cc";
  const halo = theme === "dark" ? "#000000" : "#ffffff";

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: STYLES[theme],
      center: PT_CENTER,
      zoom: 5.6,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      m.addSource("locs", {
        type: "geojson",
        data: toGeoJson([]),
        cluster: true,
        clusterRadius: 42,
        clusterMaxZoom: 12,
        promoteId: "id",
      });
      m.addLayer({
        id: "clusters",
        type: "circle",
        source: "locs",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": accent,
          "circle-opacity": 0.92,
          "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 50, 25],
          "circle-stroke-width": 3,
          "circle-stroke-color": halo,
        },
      });
      m.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "locs",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 12,
          "text-font": ["Noto Sans Regular"],
        },
        paint: { "text-color": "#ffffff" },
      });
      m.addLayer({
        id: "points",
        type: "circle",
        source: "locs",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["case", ["boolean", ["feature-state", "hl"], false], "#1d1d1f", accent],
          "circle-radius": ["case", ["boolean", ["feature-state", "hl"], false], 9, 6.5],
          "circle-stroke-width": 2.5,
          "circle-stroke-color": halo,
        },
      });
      m.on("click", "clusters", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const src = m.getSource("locs") as maplibregl.GeoJSONSource;
        src.getClusterExpansionZoom(f.properties?.cluster_id as number).then((z) => {
          m.easeTo({ center: (f.geometry as Point).coordinates as [number, number], zoom: z });
        });
      });
      m.on("click", "points", (e) => {
        const f = e.features?.[0];
        if (f && onSelect) onSelect(f.properties?.id as number);
      });
      m.on("mouseenter", "points", (e) => {
        m.getCanvas().style.cursor = "pointer";
        onHover?.((e.features?.[0]?.properties?.id as number) ?? null);
      });
      m.on("mouseleave", "points", () => {
        m.getCanvas().style.cursor = "";
        onHover?.(null);
      });
      m.on("mouseenter", "clusters", () => {
        m.getCanvas().style.cursor = "pointer";
      });
      m.on("mouseleave", "clusters", () => {
        m.getCanvas().style.cursor = "";
      });
      ready.current = true;
      m.fire("app:ready");
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      ready.current = false;
    };
  }, [onSelect, onHover, theme, accent, halo]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      const src = m.getSource("locs") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      src.setData(toGeoJson(locations));
      if (!fitOnChange) return;
      const pts: Coords[] = locations
        .filter((l) => l.coords)
        .slice(0, 60)
        .map((l) => l.coords as Coords);
      if (origin) pts.push(origin);
      if (pts.length >= 2) {
        const b = new maplibregl.LngLatBounds();
        for (const p of pts) b.extend([p.lon, p.lat]);
        m.fitBounds(b, { padding: 56, maxZoom: 14, duration: 500 });
      } else if (pts.length === 1) {
        m.easeTo({ center: [pts[0]!.lon, pts[0]!.lat], zoom: 14 });
      }
    };
    if (ready.current) apply();
    else m.once("app:ready", apply);
  }, [locations, origin, fitOnChange]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    originMarker.current?.remove();
    originMarker.current = null;
    if (origin) {
      const dot = document.createElement("div");
      dot.style.cssText = `width:16px;height:16px;border-radius:50%;background:#1d1d1f;border:3px solid ${halo};box-shadow:0 0 0 2px rgba(0,0,0,.25)`;
      originMarker.current = new maplibregl.Marker({ element: dot })
        .setLngLat([origin.lon, origin.lat])
        .addTo(m);
    }
  }, [origin, halo]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    if (prevHl.current != null)
      m.setFeatureState({ source: "locs", id: prevHl.current }, { hl: false });
    if (highlightId != null) m.setFeatureState({ source: "locs", id: highlightId }, { hl: true });
    prevHl.current = highlightId ?? null;
  }, [highlightId]);

  return <div ref={el} className={className} style={{ width: "100%", height: "100%" }} />;
}
