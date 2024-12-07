import React, { useEffect, useState } from 'react';
import Map from './components/Map';
import Dashboard from './components/Dashboard';
import Chat from './components/Chat';
import { apiService} from './services/api';

interface Event {
  id: string;
  type: 'new_order' | 'pickup' | 'delivery';
  message: string;
  timestamp: string;
  location?: string;
  destination?: string;
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

interface Message {
    id: string;
    text: string;
    sender: 'user' | 'bot';
    timestamp: Date;
}

const App: React.FC = () => {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [metrics, setMetrics] = useState({
    packages_retrieved: 0,
    awaiting_pickup: 0,
    average_response_time: "0",
  });
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  const fetchMetrics = async () => {
    try {
      const metricsData = await apiService.getMetrics();
      setMetrics(metricsData);
    } catch (err) {
      console.error('Error fetching metrics:', err);
    }
  };

  const handleNewEvent = (event: Event) => {
    setEvents(prev => [event, ...prev].slice(0, 10)); 
    
    // Update metrics based on event type
    setMetrics(prev => {
      switch (event.type) {
        case 'new_order':
          return {
            ...prev,
            awaiting_pickup: prev.awaiting_pickup + 1
          };
        case 'delivery':
          return {
            ...prev,
            packages_retrieved: prev.packages_retrieved + 1,
            awaiting_pickup: Math.max(0, prev.awaiting_pickup - 1)
          };
        default:
          return prev;
      }
    });
  };

  // Add WebSocket connection for real-time events
  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 3;
    let ws: WebSocket;

    const connect = () => {
      try {
        ws = new WebSocket('ws://localhost:8000/ws/events');
        
        ws.onopen = () => {
          console.log('WebSocket Connected');
          retryCount = 0;
        };
        
        ws.onmessage = (event) => {
          try {
            const newEvent = JSON.parse(event.data);
            handleNewEvent(newEvent);
          } catch (error) {
            console.error('Error parsing event:', error);
          }
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
        };

        ws.onclose = (event) => {
          console.log('WebSocket closed:', event.code, event.reason);
          if (retryCount < maxRetries) {
            retryCount++;
            console.log(`Retrying connection (${retryCount}/${maxRetries})...`);
            setTimeout(connect, 1000 * retryCount);
          }
        };
      } catch (error) {
        console.error('Connection error:', error);
      }
    };

    connect();

    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, []);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const [routesData, metricsData] = await Promise.all([
          apiService.getRoutes(),
          apiService.getMetrics(),
        ]);
        console.log('Received routes data:', routesData);
        setRoutes(routesData);
        setMetrics(metricsData);
      } catch (err) {
        console.error('Error loading data:', err);
        setError('Failed to load data. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();

    // Set up polling for metrics every 2 seconds
    const metricsInterval = setInterval(fetchMetrics, 2000);

    // Cleanup
    return () => {
      clearInterval(metricsInterval);
    };
  }, []);

  const handleRouteComplete = async (routeId: string) => {
    try {
      // Get a new route from the backend
      const newRoute = await apiService.getNewRoute();
      
      // Update routes array - remove completed route and add new one
      setRoutes(prevRoutes => {
        const updatedRoutes = prevRoutes.filter(r => r.id !== routeId);
        return [...updatedRoutes, newRoute];
      });
    } catch (error) {
      console.error('Error getting new route:', error);
    }
  };


  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900 text-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          <p className="mt-4">Loading...</p>
        </div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900 text-white">
        <div className="text-center p-4">
          <p className="text-red-500 mb-4">⚠️ {error}</p>
          <button 
            onClick={() => window.location.reload()} 
            className="bg-blue-500 px-4 py-2 rounded hover:bg-blue-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-screen">
      <Dashboard
        packagesRetrieved={metrics.packages_retrieved}
        awaitingPickup={metrics.awaiting_pickup}
        averageResponseTime={metrics.average_response_time}
        events={events}
      />
      <div className="flex-1 relative">
        <Map routes={routes} onRouteComplete={handleRouteComplete} />
      </div>
      <Chat messages={messages} setMessages={setMessages} />
    </div>
  );
};

export default App;
