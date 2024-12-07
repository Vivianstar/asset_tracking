import React, { useEffect, useRef, useCallback, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN || '';

interface MapProps {
  routes: any[];
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
  start_location?: string;
  end_location?: string;
}

const Map: React.FC<MapProps> = ({ routes, onRouteComplete }) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const routeSourcesRef = useRef<string[]>([]);
  const markersRef = useRef<{ [key: string]: mapboxgl.Marker }>({});
  const animationFrameRef = useRef<number>();
  const startEndMarkersRef = useRef<{ [key: string]: { start: mapboxgl.Marker, end: mapboxgl.Marker } }>({});
  const [mapInitialized, setMapInitialized] = useState(false);

  const interpolatePosition = (route: Route, currentTime: number) => {
    const coordinates = route.coordinates;
    const waypoints = route.waypoints;
    
    // Calculate total route duration (4 seconds per segment)
    const routeDuration = (coordinates.length - 1) * 100;
    
    // Get start time from first waypoint
    const startTime = new Date(waypoints[0].timestamp).getTime();
    
    // Calculate elapsed time and progress
    const elapsedTime = currentTime - startTime;
    const progress = Math.min(1, elapsedTime / routeDuration); // Cap progress at 1
    
    // Find current segment
    const totalSegments = coordinates.length - 1;
    const currentIndex = Math.min(
        Math.floor(progress * totalSegments),
        totalSegments - 1
    );
    const nextIndex = Math.min(currentIndex + 1, coordinates.length - 1);
    
    // Calculate progress within segment
    const segmentProgress = Math.min(
        (progress * totalSegments) - currentIndex,
        1
    );
    // Check if route is completed (reached end point)
    if (progress >= 0.99 && route.status !== 'completed') {
        // Call API to update metrics
        fetch('http://localhost:8000/api/delivery-complete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                routeId: route.id,
                completionTime: new Date().getTime() - startTime
            })
        })
        .then(() => {
            // Immediately update route status locally
            route.status = 'completed';
            // Call the callback to notify parent
            onRouteComplete(route.id);
            
            // Remove route line and markers
            const sourceId = `route-${route.id}`;
            if (map.current?.getLayer(sourceId)) {
                map.current.removeLayer(sourceId);
            }
            if (map.current?.getSource(sourceId)) {
                map.current.removeSource(sourceId);
            }
            
            // Remove delivery vehicle marker
            if (markersRef.current[route.id]) {
                markersRef.current[route.id].remove();
                delete markersRef.current[route.id];
            }

            // Remove start/end markers
            if (startEndMarkersRef.current[route.id]) {
                const markers = startEndMarkersRef.current[route.id];
                markers.start.remove();  
                markers.end.remove();    
                delete startEndMarkersRef.current[route.id];
            }
        })
        .catch(console.error);
        
        // Return final destination coordinates
        return coordinates[coordinates.length - 1];
    }
    
    // Interpolate between points
    const currentPos = [
        coordinates[currentIndex][0] + (coordinates[nextIndex][0] - coordinates[currentIndex][0]) * segmentProgress,
        coordinates[currentIndex][1] + (coordinates[nextIndex][1] - coordinates[currentIndex][1]) * segmentProgress
    ];

    return currentPos;
  }; 

  const animateMarkers = useCallback(() => {
    const currentTime = new Date().getTime();
    
    routes.forEach(route => {
      if (route.status === 'completed') {
        // Remove completed route markers
        if (markersRef.current[route.id]) {
          markersRef.current[route.id].remove();
          delete markersRef.current[route.id];
        }
        
        // Remove route line and start/end markers
        const sourceId = `route-${route.id}`;
        if (map.current?.getLayer(sourceId)) {
          map.current.removeLayer(sourceId);
        }
        if (map.current?.getSource(sourceId)) {
          map.current.removeSource(sourceId);
        }
        return;
      }

      const currentPos = interpolatePosition(route, currentTime);
      
      if (!markersRef.current[route.id]) {
        // Create marker for the first time
        const el = document.createElement('div');
        el.className = 'delivery-vehicle';
        el.style.backgroundColor = route.color;
        el.style.width = '12px';
        el.style.height = '12px';
        el.style.borderRadius = '50%';
        el.style.border = '2px solid white';
        el.style.boxShadow = '0 0 8px 0 rgba(0, 0, 0, 0.5)';
        
        // Create popup only once
        const popup = new mapboxgl.Popup({ 
            offset: 10,
            closeButton: false,
            closeOnClick: false,
        })
        .setHTML(`
            <div style="background-color: ${route.color}CC; padding: 10px; border-radius: 18px;">
                <div style="color: white; font-size: 0.75rem;">ID: ${String(route.id).substring(0,3)}</div>
            </div>
        `);
        
        markersRef.current[route.id] = new mapboxgl.Marker(el)
            .setLngLat(currentPos as [number, number])
            .setPopup(popup)
            .addTo(map.current!);
        
        markersRef.current[route.id].togglePopup();
      } else {
        // Just update marker position
        const marker = markersRef.current[route.id];
        marker.setLngLat(currentPos as [number, number]);
        
        // Update popup position without recreating it
        const popup = marker.getPopup();
        if (popup && popup.isOpen()) {
          popup.setLngLat(currentPos as [number, number]);
        }
      }
    });
    
    animationFrameRef.current = requestAnimationFrame(animateMarkers);
  }, [routes]);

  // Single initialization effect
  useEffect(() => {
    // Skip if already initialized or no container
    if (mapInitialized || !mapContainer.current || map.current) {
      return;
    }

    console.log('Initializing new map instance');
    
    // Clear any existing content
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

  // Clean up previous markers
  Object.values(markersRef.current).forEach(marker => marker.remove());
  markersRef.current = {};

  function updateMapData() {
    console.log("updateMapData called", {
      mapExists: !!map.current,
      styleLoaded: map.current?.isStyleLoaded(),
      routesCount: routes.length
    });
    
    if (!map.current) return;
    // Remove existing route layers and sources
    routeSourcesRef.current.forEach(sourceId => {
      if (map.current?.getLayer(sourceId)) {
        map.current.removeLayer(sourceId);
      }
      if (map.current?.getSource(sourceId)) {
        map.current.removeSource(sourceId);
      }
    });
    
    routeSourcesRef.current = [];
    
    // Add only in-progress routes
    routes.filter(route => route.status !== 'completed').forEach(route => {
      const sourceId = `route-${route.id}`;
      routeSourcesRef.current.push(sourceId);

      // Create GeoJSON data for the route
      const geojsonData = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: route.coordinates
        }
      };

      try {
        // Add source and layer for the route line
        if (!map.current?.getSource(sourceId)) {
          map.current?.addSource(sourceId, {
            type: 'geojson',
            data: geojsonData as any
          });

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
              'line-opacity': 0.8
            }
          });
        }
      } catch (error) {
        console.error('Error adding route to map:', error);
      }

      // Only add start/end markers for in-progress routes
      const markerSvg = `
        <svg width="24" height="36" viewBox="0 0 24 36" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 0C5.37258 0 0 5.37258 0 12C0 18.6274 12 36 12 36C12 36 24 18.6274 24 12C24 5.37258 18.6274 0 12 0Z" 
            fill="${route.color}"
          />
          <circle cx="12" cy="12" r="5" fill="white"/>
        </svg>
      `;
      console.log("adding--start marker", route.start_location);
      const startEl = document.createElement('div');
      startEl.className = 'marker-pin';
      startEl.innerHTML = markerSvg;
      startEl.title = `Start: ${route.start_location || 'Loading...'}`;
      console.log("adding--end marker", route.end_location);
      const endEl = document.createElement('div');
      endEl.className = 'marker-pin';
      endEl.innerHTML = markerSvg;
      endEl.title = `Destination: ${route.end_location || 'Loading...'}`;

      // Before creating new markers, check if they already exist
      if (startEndMarkersRef.current[route.id]) {
          // Maybe remove existing markers first
          startEndMarkersRef.current[route.id].start.remove();
          startEndMarkersRef.current[route.id].end.remove();
      }
      
      const startPopup = new mapboxgl.Popup({ offset: 0 })
          .setHTML(`
              <div style="background-color: ${route.color}; padding: 10px; border-radius: 20px;">
                  <div style="color: white; font-size: 0.75rem;">Start Location</div>
                  <div style="color: white; font-size: 0.75rem;">
                      ${route.start_point[0].toFixed(4)}, ${route.start_point[1].toFixed(4)}
                  </div>
              </div>
          `);

      const endPopup = new mapboxgl.Popup({ offset: 0 })
          .setHTML(`
              <div style="background-color: ${route.color}; padding: 10px; border-radius: 20px;">
                  <div style="color: white; font-size: 0.75rem;">End Location</div>
                  <div style="color: white; font-size: 0.75rem;">
                      ${route.end_point[0].toFixed(4)}, ${route.end_point[1].toFixed(4)}
                  </div>
              </div>
          `);

      startEndMarkersRef.current[route.id] = {
          start: new mapboxgl.Marker({
              element: startEl,
              anchor: 'bottom'
          })
              .setLngLat(route.start_point)
              .setPopup(startPopup)  // Add popup to start marker
              .addTo(map.current!),
          end: new mapboxgl.Marker({
              element: endEl,
              anchor: 'bottom'
          })
              .setLngLat(route.end_point)
              .setPopup(endPopup)    // Add popup to end marker
              .addTo(map.current!)
      };
    });
    console.log("start animation", animationFrameRef.current);
    // Start animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(animateMarkers);
  }


  return <div ref={mapContainer} className="w-full h-full" />;
};

export default Map;
