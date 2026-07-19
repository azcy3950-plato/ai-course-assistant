'use client';

import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, GeoJSON, Polygon, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { FloodGrid, SandboxLayer } from '@/types';
import { DEFAULT_CENTER, DEFAULT_ZOOM, getFloodColor } from '@/data/sandbox-scenarios';

// Fix Leaflet default marker icon issue
import 'leaflet/dist/leaflet.css';

// Sample static layer data (simplified GeoJSON-like structures)
const staticLayerData: Record<string, GeoJSON.FeatureCollection> = {
  terrain: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: '研究区域', elevation: '4-8m' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [121.465, 31.232], [121.480, 31.232],
            [121.480, 31.225], [121.465, 31.225],
            [121.465, 31.232],
          ]],
        },
      },
    ],
  },
  pipes: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: '主干管网', diameter: 'DN800' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [121.468, 31.230], [121.472, 31.229],
            [121.476, 31.228], [121.478, 31.227],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { name: '支管', diameter: 'DN400' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [121.472, 31.229], [121.473, 31.231],
            [121.474, 31.226], [121.476, 31.228],
          ],
        },
      },
    ],
  },
  buildings: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: '建筑群A', floors: 6 },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [121.470, 31.231], [121.4715, 31.231],
            [121.4715, 31.2295], [121.470, 31.2295],
            [121.470, 31.231],
          ]],
        },
      },
    ],
  },
  roads: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: '主干道' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [121.465, 31.229], [121.480, 31.229],
          ],
        },
      },
    ],
  },
};

const layerStyles: Record<string, any> = {
  terrain: { color: '#8B7355', weight: 2, fillColor: '#D2B48C', fillOpacity: 0.3 },
  pipes: { color: '#2563eb', weight: 3, dashArray: '5 5' },
  buildings: { color: '#64748b', weight: 1, fillColor: '#94a3b8', fillOpacity: 0.5 },
  roads: { color: '#475569', weight: 2 },
};

interface Props {
  floodGrids: FloodGrid[];
  visibleLayers: SandboxLayer[];
  mode: 'static' | 'dynamic';
}

// Helper to update map view (must be inside MapContainer child)
function MapBoundsUpdater({ floodGrids }: { floodGrids: FloodGrid[] }) {
  const map = useMap();

  useEffect(() => {
    if (floodGrids.length > 0) {
      const lats = floodGrids.map(g => g.lat);
      const lngs = floodGrids.map(g => g.lng);
      const bounds = L.latLngBounds(
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)]
      );
      map.fitBounds(bounds.pad(0.1));
    }
  }, [floodGrids, map]);

  return null;
}

export default function MapView({ floodGrids, visibleLayers, mode }: Props) {
  // Memoize flood polygons
  const floodPolygons = useMemo(() => {
    if (mode !== 'dynamic' || floodGrids.length === 0) return [];
    return floodGrids.map((grid, i) => {
      const d = 0.001; // half-degree size
      return {
        key: i,
        positions: [
          [grid.lat - d, grid.lng - d],
          [grid.lat - d, grid.lng + d],
          [grid.lat + d, grid.lng + d],
          [grid.lat + d, grid.lng - d],
        ] as [number, number][],
        color: getFloodColor(grid.depth),
        depth: grid.depth,
      };
    }).filter(p => p.depth > 0.01);
  }, [floodGrids, mode]);

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      style={{ height: '100%', width: '100%' }}
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/* Static layers */}
      {visibleLayers.map(layer => {
        const data = staticLayerData[layer.id];
        if (!data) return null;
        return (
          <GeoJSON
            key={layer.id}
            data={data}
            style={() => layerStyles[layer.id] || {}}
          />
        );
      })}

      {/* Flood grid overlay */}
      {floodPolygons.map(poly => (
        <Polygon
          key={poly.key}
          positions={poly.positions}
          pathOptions={{
            color: poly.color,
            fillColor: poly.color,
            fillOpacity: 0.6,
            weight: 1,
          }}
        >
          <Popup>
            <div className="text-xs">
              <strong>积水深度:</strong> {poly.depth.toFixed(2)} m
            </div>
          </Popup>
        </Polygon>
      ))}

      <MapBoundsUpdater floodGrids={floodGrids} />
    </MapContainer>
  );
}
