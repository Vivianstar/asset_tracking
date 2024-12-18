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
        timestamp: Date.now()
      });

      if (route.status !== 'completed') {
        // Create new marker if it doesn't exist
        if (!markerStatesRef.current[update.route_id]) {
          const lastWaypoint = route.waypoints[route.waypoints.length - 1] || route.start_point;
          // Convert RoutePoint to coordinate tuple if needed
          const position: [number, number] = Array.isArray(lastWaypoint) 
            ? lastWaypoint as [number, number]
            : [lastWaypoint.longitude, lastWaypoint.latitude];
          const marker = createDeliveryMarker(route, position, map.current!);
          if (marker) {
            markerStatesRef.current[update.route_id] = {
              marker,
              targetPosition: newPosition
            };
          }
        } else {
          // Update target position instead of directly setting marker position
          markerStatesRef.current[update.route_id].targetPosition = newPosition;
        }
      }

      // Check if route is near completion
      if (newPosition[0] === route.end_point[0] && 
          newPosition[1] === route.end_point[1] && 
          route.status !== 'completed') {
        route.status = 'completed';
        
        // Call API to update metrics
        fetch('http://localhost:8000/api/delivery-complete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            routeId: route.id,
            completionTime: Date.now() - route.waypoints[0].timestamp
          })
        })
        .then(() => {
          cleanupRoute(route.id);
          onRouteComplete(route.id);
        })
        .catch(console.error);

        return;
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
        if (marker) {
          markerStatesRef.current[route.id] = {
            marker,
            targetPosition: initialPosition
          };
        }
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

    console.log("routes", routes);
    // Add new sources and layers for each route
    routes.forEach(route => {
      if (route.status === 'completed') return; // Skip completed routes
      
      const sourceId = `route-${route.id}`;
      routeSourcesRef.current.push(sourceId);
      
      try {
        if (!map.current) {
          throw new Error('Map not initialized');
        }
        
        const success = addRouteToMap(route, map.current, sourceId);
        if (success) {
          console.log('Successfully added route:', route.id);
        } else {
          console.error('Failed to add route:', route.id);
        }
      } catch (error) {
        console.error('Error in route addition process:', route.id, error);
      }
    });
    // Start animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(animate);
  };

  const createDeliveryMarker = (
    route: Route, 
    position: [number, number], 
    map: mapboxgl.Map
  ) => {
    try {
      // Validate coordinates
      if (!position || position.length !== 2 || position.some(coord => !Number.isFinite(coord))) {
        console.warn('Skipping marker creation - Invalid coordinates:', position);
        return null;
      }

      // Validate and clean color value
      let validColor = route.color;
      
      // If color contains multiple hex codes, take the first one
      if (route.color.includes('#', 1)) {
        validColor = route.color.split('#')[1];
        validColor = '#' + validColor;
      }
      
      // Ensure it's a valid 6-digit hex color
      if (!/^#[0-9A-F]{6}$/i.test(validColor)) {
        console.warn(`Invalid color format for route ${route.id}, defaulting to #000000`);
        validColor = '#000000';
      }

      const el = document.createElement('div');
      el.className = 'delivery-vehicle';
      el.style.backgroundColor = validColor;
      el.style.width = '12px';
      el.style.height = '12px';
      el.style.borderRadius = '50%';
      el.style.border = '2px solid white';

      const popup = new mapboxgl.Popup({ 
        offset: 10,
        closeButton: false,
        closeOnClick: false,
      }).setHTML(`
        <div style="background-color: ${validColor}CC; padding: 10px; border-radius: 18px;">
          <div style="color: white; font-size: 0.75rem;">Route ${String(route.id).substring(0,2)}</div>
        </div>
      `);
      
      const marker = new mapboxgl.Marker(el)
        .setLngLat(position)
        .setPopup(popup)
        .addTo(map);
        
      marker.togglePopup();
      
      return marker;
    } catch (error) {
      console.warn('Error creating delivery marker:', error);
      return null;
    }
  };

  const addRouteToMap = (route: Route, map: mapboxgl.Map, sourceId: string) => {
    try {
      // Validate and clean color value
      let validColor = route.color;
      
      // If color contains multiple hex codes, take the first one
      if (route.color.includes('#', 1)) {
        validColor = route.color.split('#')[1];
        validColor = '#' + validColor;
      }
      
      // Ensure it's a valid 6-digit hex color
      if (!/^#[0-9A-F]{6}$/i.test(validColor)) {
        console.warn(`Invalid color format for route ${route.id}, defaulting to #000000`);
        validColor = '#000000';
      }

      // Add source if it doesn't exist
      if (!map.getSource(sourceId)) {
        console.log(`Adding source for route ${route.id}`);
        try {
          map.addSource(sourceId, {
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
          console.log(`Successfully added source for route ${route.id}`);
        } catch (sourceError) {
          console.error(`Error adding source for route ${route.id}:`, sourceError);
          throw sourceError;
        }
      }

      // Add layer with validated color
      if (!map.getLayer(sourceId)) {
        console.log(`Adding layer for route ${route.id}`);
        try {
          map.addLayer({
            id: sourceId,
            type: 'line',
            source: sourceId,
            layout: {
              'line-join': 'round',
              'line-cap': 'round'
            },
            paint: {
              'line-color': validColor,
              'line-width': 3,
              'line-opacity': route.status === 'completed' ? 0.5 : 1
            }
          });
          console.log(`Successfully added layer for route ${route.id}`);
        } catch (layerError) {
          console.error(`Error adding layer for route ${route.id}:`, layerError);
          throw layerError;
        }
      }

      // Add start/end markers only if they don't exist for this route
      if (!startEndMarkersRef.current[route.id]) {
        console.log(`Adding markers for route ${route.id}`);
        try {
          // Validate start and end points
          if (!route.start_point?.every(coord => !isNaN(coord)) || 
              !route.end_point?.every(coord => !isNaN(coord))) {
            throw new Error('Invalid start or end coordinates');
          }

          const startMarker = new mapboxgl.Marker({ color: validColor })
            .setLngLat(route.start_point)
            .setPopup(new mapboxgl.Popup().setText('Start'))
            .addTo(map);

          const endMarker = new mapboxgl.Marker({ color: validColor })
            .setLngLat(route.end_point)
            .setPopup(new mapboxgl.Popup().setText('End'))
            .addTo(map);

          startEndMarkersRef.current[route.id] = { start: startMarker, end: endMarker };
          console.log(`Successfully added markers for route ${route.id}`);
        } catch (markerError) {
          console.error(`Error adding markers for route ${route.id}:`, markerError);
          throw markerError;
        }
      }

      console.log(`Route ${route.id} successfully added with all components`);
      return true;
    } catch (error) {
      console.error(`Fatal error adding route ${route.id}:`, error);
      cleanupRoute(route.id);
      return false;
    }
  };

  return <div ref={mapContainer} className="w-full h-full" />;
};

export default Map;
