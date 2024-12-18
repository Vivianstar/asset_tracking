import React, { useEffect, useRef, useCallback, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN || '';

interface MapProps {
  routes: any[];
  onNewRoute: (routeId: string) => void;
  onRouteComplete: (routeId: string) => void;
}

interface RoutePoint {
  longitude: number;
  latitude: number;
  timestamp: string;
}

interface Route {
  id: string;
  coordinates: [number, number][];
  color: string;
  delivery_ids: string[];
  waypoints: RoutePoint[];
  status: 'in_progress' | 'completed';
  start_point: [number, number];
  end_point: [number, number];
}

interface RouteUpdate {
  route_id: string;
  longitude: number;
  latitude: number;
  timestamp: number;
}

// Add this interface at the top with other interfaces
interface MarkerState {
  marker: mapboxgl.Marker;
  targetPosition: [number, number];
}

const Map: React.FC<MapProps> = ({ routes, onNewRoute, onRouteComplete }) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const routeSourcesRef = useRef<string[]>([]);
  const animationFrameRef = useRef<number>();
  const startEndMarkersRef = useRef<{ [key: string]: { start: mapboxgl.Marker, end: mapboxgl.Marker } }>({});
  const [mapInitialized, setMapInitialized] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const markerStatesRef = useRef<{ [key: string]: MarkerState }>({});
  const [seenRouteIds, setSeenRouteIds] = useState<Set<string>>(new Set());

  // Single initialization effect
  useEffect(() => {
    if (mapInitialized || !mapContainer.current || map.current) {
      return;
    }

    console.log('Initializing new map instance');
    
    while (mapContainer.current.firstChild) {
      mapContainer.current.removeChild(mapContainer.current.firstChild);
    }

    const initializedMap = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v10',
      center: [-74.006, 40.7128],
      zoom: 12
    });

    // Store style load state
    initializedMap.on('style.load', () => {
      console.log('Initial style loaded');
      map.current = initializedMap;
      setMapInitialized(true);
    });

    initializedMap.on('style.error', (e) => {
      console.error('Style loading error:', e);
    });

    // Add debug logging
    initializedMap.on('styledata', () => {
      console.log('Style data updated, isStyleLoaded:', initializedMap.isStyleLoaded());
    });

    initializedMap.addControl(new mapboxgl.NavigationControl(), 'top-left');

    // Cleanup function
    return () => {
      console.log('Cleaning up map instance');
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
      setMapInitialized(false);
    };
  }, []); // Empty dependency array for single initialization

  // Route update effect
  useEffect(() => {
    if (!mapInitialized) {
      console.log('Map not initialized yet');
      return;
    }

    if (!map.current) {
      console.log('Map instance not available');
      return;
    }

    // Wait for style to be loaded
    if (!map.current.isStyleLoaded()) {
      console.log('Waiting for style to load...');
      const checkStyle = setInterval(() => {
        if (map.current?.isStyleLoaded()) {
          console.log('Style loaded, updating map data');
          clearInterval(checkStyle);
          updateMapData();
        }
      }, 100);

      return () => clearInterval(checkStyle);
    }

    console.log('Updating map with new routes');
    updateMapData();
  }, [routes, mapInitialized]);

  // Fit map bounds to route coordinates
  if (map.current && routes.length > 0) {
    const bounds = new mapboxgl.LngLatBounds();
    routes.forEach(route => {
      route.coordinates.forEach((coord: [number, number]) => {
        bounds.extend([coord[0], coord[1]]);
      });
    });
    map.current.fitBounds(bounds, { padding: 50 });
  }

  const cleanupRoute = (routeId: string) => {
    // Remove map layers and sources
    const sourceId = `route-${routeId}`;
    if (map.current?.getLayer(sourceId)) {
      map.current.removeLayer(sourceId);
    }
    if (map.current?.getSource(sourceId)) {
      map.current.removeSource(sourceId);
    }
    
    // Remove vehicle marker
    if (markerStatesRef.current[routeId]) {
      markerStatesRef.current[routeId].marker.remove();
      delete markerStatesRef.current[routeId];
    }
    
    // Remove start/end markers
    if (startEndMarkersRef.current[routeId]) {
      const markers = startEndMarkersRef.current[routeId];
      markers.start.remove();
      markers.end.remove();
      delete startEndMarkersRef.current[routeId];
    }
  };
  
  // Modify the WebSocket effect to use the cleanup function
  useEffect(() => {
    wsRef.current = new WebSocket('ws://localhost:8000/ws/route-updates');
    
    wsRef.current.onmessage = async (event) => {
      const update: RouteUpdate = JSON.parse(event.data);
      
      // Check if this is a new route ID
      if (!seenRouteIds.has(update.route_id)) {
        setSeenRouteIds(prev => new Set(prev).add(update.route_id));
        try {
          onNewRoute(update.route_id);
        } catch (error) {
          console.error('Error fetching new route:', error);
        }
      }

      const route = routes.find(r => r.id === update.route_id);
      if (!route) return;

      const newPosition: [number, number] = [update.longitude, update.latitude];
      
      route.waypoints.push({
        longitude: update.longitude,
        latitude: update.latitude,
        timestamp: new Date().toISOString()
      });

      // Check if route is near completion
      if (newPosition[0] === route.end_point[0] && 
          newPosition[1] === route.end_point[1] && 
          route.status !== 'completed') {
        route.status = 'completed';
        
        // Call API to update metrics
        cleanupRoute(route.id);
        onRouteComplete(route.id);
        return;
      }
      
      // Only update marker position if route is not completed
      if (route.status !== 'completed') {
        // Create new marker if it doesn't exist
        if (!markerStatesRef.current[update.route_id]) {
          const lastWaypoint = route.waypoints[route.waypoints.length - 1];
          const marker = createDeliveryMarker(route, lastWaypoint, map.current!);
          markerStatesRef.current[update.route_id] = {
            marker,
            targetPosition: newPosition
          };
        } else {
          // Update target position instead of directly setting marker position
          markerStatesRef.current[update.route_id].targetPosition = newPosition;
        }
      }
    };

    return () => {
      wsRef.current?.close();
      // Clean up all markers when unmounting
      Object.keys(markerStatesRef.current).forEach(routeId => {
        cleanupRoute(routeId);
      });
    };
  }, [routes]);

  // Modify the animate callback to include interpolation for smooth movement
  const animate = useCallback(() => {
    if (!map.current || !map.current.isStyleLoaded()) {
      animationFrameRef.current = requestAnimationFrame(animate);
      return;
    }

    routes.forEach(route => {
      if (route.status === 'completed') {
        cleanupRoute(route.id);
        return;
      }

      // First check if marker state exists
      if (!markerStatesRef.current[route.id]) {
        // If no marker state exists, create one with initial position
        const lastWaypoint = route.waypoints[route.waypoints.length - 1];
        const initialPosition: [number, number] = lastWaypoint 
          ? [lastWaypoint.longitude, lastWaypoint.latitude]
          : route.start_point;
        const marker = createDeliveryMarker(route, initialPosition, map.current!);
        markerStatesRef.current[route.id] = {
          marker,
          targetPosition: initialPosition
        };
      } else {
        const markerState = markerStatesRef.current[route.id];
        const marker = markerState.marker;
        const currentPos = marker.getLngLat();
        const targetPos = markerState.targetPosition;
        
        // Interpolate between current and target position
        const lerp = (start: number, end: number, t: number) => start + (end - start) * t;
        const smoothing = 0.1; 
        
        const newLng = lerp(currentPos.lng, targetPos[0], smoothing);
        const newLat = lerp(currentPos.lat, targetPos[1], smoothing);
        
        marker.setLngLat([newLng, newLat]);
        
        // Update popup position if it's open
        const popup = marker.getPopup();
        if (popup && popup.isOpen()) {
          popup.setLngLat([newLng, newLat]);
        }
      }
    });
    
    animationFrameRef.current = requestAnimationFrame(animate);
  }, [routes]);

  const updateMapData = () => {
    if (!map.current || !map.current.isStyleLoaded()) {
      console.log('Map not ready for updates');
      return;
    }
    Object.values(markerStatesRef.current).forEach(state => state.marker.remove());
    Object.values(startEndMarkersRef.current).forEach(markers => {
      markers.start.remove();
      markers.end.remove();
    });

    // Remove old sources and layers
    routeSourcesRef.current.forEach(sourceId => {
      if (map.current?.getLayer(sourceId)) {
        map.current.removeLayer(sourceId);
      }
      if (map.current?.getSource(sourceId)) {
        map.current.removeSource(sourceId);
      }
    });
    routeSourcesRef.current = [];
    startEndMarkersRef.current = {};

    // Add new sources and layers for each route
    routes.forEach(route => {
      if (route.status === 'completed') return; // Skip completed routes
      
      const sourceId = `route-${route.id}`;
      routeSourcesRef.current.push(sourceId);

      // Add source if it doesn't exist
      if (!map.current?.getSource(sourceId)) {
        map.current?.addSource(sourceId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: route.coordinates
            }
          }
        });
      }

      // Add layer if it doesn't exist
      if (!map.current?.getLayer(sourceId)) {
        map.current?.addLayer({
          id: sourceId,
          type: 'line',
          source: sourceId,
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': route.color,
            'line-width': 3,
            'line-opacity': route.status === 'completed' ? 0.5 : 1
          }
        });
      }

      // Add start/end markers
      const startMarker = new mapboxgl.Marker({ color: route.color })
        .setLngLat(route.start_point)
        .setPopup(new mapboxgl.Popup().setText(route.start_location || 'Start'))
        .addTo(map.current!);

      const endMarker = new mapboxgl.Marker({ color: route.color })
        .setLngLat(route.end_point)
        .setPopup(new mapboxgl.Popup().setText(route.end_location || 'End'))
        .addTo(map.current!);

      startEndMarkersRef.current[route.id] = { start: startMarker, end: endMarker };
    });
    console.log("start animation", animationFrameRef.current);
    // Start animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(animate);
  };

  const createDeliveryMarker = (route: Route, position: [number, number], map: mapboxgl.Map) => {
    const el = document.createElement('div');
    el.className = 'delivery-vehicle';
    el.style.backgroundColor = route.color;
    el.style.width = '12px';
    el.style.height = '12px';
    el.style.borderRadius = '50%';
    el.style.border = '2px solid white';

    
    const popup = new mapboxgl.Popup({ 
      offset: 10,
      closeButton: false,
      closeOnClick: false,
    }).setHTML(`
      <div style="background-color: ${route.color}CC; padding: 10px; border-radius: 18px;">
        <div style="color: white; font-size: 0.75rem;">Route ${String(route.id).substring(0,2)}</div>
      </div>
    `);
    
    const marker = new mapboxgl.Marker(el)
      .setLngLat(position)
      .setPopup(popup)
      .addTo(map);
      
    marker.togglePopup();
    
    return marker;
  };

  return <div ref={mapContainer} className="w-full h-full" />;
};

export default Map;
