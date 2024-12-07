import React, { useEffect, useRef } from 'react';
import CountUp from 'react-countup';
import '../styles/fonts.css';

interface Event {
  id: string;
  type: 'new_order' | 'pickup' | 'delivery';
  message: string;
  timestamp: string;
  location?: string;
  destination?: string;
}

interface DashboardProps {
  packagesRetrieved: number;
  awaitingPickup: number;
  averageResponseTime: string;
  events: Event[];
}

const Dashboard: React.FC<DashboardProps> = ({
  packagesRetrieved,
  awaitingPickup,
  averageResponseTime,
  events
}) => {
  const prevPackagesRef = useRef(packagesRetrieved);
  const prevAwaitingRef = useRef(awaitingPickup);
  const prevTimeRef = useRef(parseFloat(averageResponseTime));

  useEffect(() => {
    prevPackagesRef.current = packagesRetrieved;
    prevAwaitingRef.current = awaitingPickup;
    prevTimeRef.current = parseFloat(averageResponseTime);
  }, [packagesRetrieved, awaitingPickup, averageResponseTime]);

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'new_order':
        return '⭐';
      case 'pickup':
        return '🚚';
      case 'delivery':
        return '📦';
      default:
        return '•';
    }
  };
  return (
    <div className="relative w-[360px] h-full overflow-hidden">
      <div className="absolute inset-0 bg-[#1A1A1A]" />
      
      <div className="relative h-full p-2">
        <div className="space-y-2">
          <div className="text-center py-2 px-2">
            <div className="text-gray-400 text-lg uppercase tracking-wider py-2">
              EVENTS
            </div>
            <div className="space-y-2">
              {events.slice(-4).map((event) => (
                <div key={event.id} className="bg-[#35363a] p-3 rounded-2xl animate-fade-in">
                  <div className="flex items-center gap-2">
                    <span className="text-yellow-400">{getEventIcon(event.type)}</span>
                    <span className="text-gray-300 text-sm text-left">
                      {event.type === 'new_order' && (
                        <>
                          <span className="bg-blue-800/50 px-2 py-0.5 rounded">New order</span>
                          <span>: {event.location}</span>
                        </>
                      )}
                      {event.type === 'pickup' && (
                        <>
                          <span className="bg-amber-800/50 px-2 py-0.5 rounded">Pickup</span>
                          <span> at {event.location}</span>
                        </>
                      )}
                      {event.type === 'delivery' && (
                        <>
                          <span className="bg-green-800/50 px-2 py-0.5 rounded">Delivered</span>
                          <span> to {event.location}</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="text-center py-1 px-2">
            <div className="text-gray-400 text-lg uppercase tracking-wider py-2">
              AVERAGE DELIVERY TIME
            </div>
            <p className="text-7xl mt-4 text-white seven-segment transform scale-y-110">
              <CountUp 
                start={prevTimeRef.current}
                end={parseFloat(averageResponseTime || '0')}
                decimals={1}
                duration={1.5}
                suffix=" mins"
                useEasing={true}
                preserveValue={true}
                decimal="."
              />
            </p>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center py-4 px-2">
              <div className="text-gray-400 text-lg uppercase tracking-wider py-2">
                PACKAGES
                <div className="h-2"></div>   
                DELIVERED
              </div>
              <p className="text-8xl mt-6 text-white seven-segment transform scale-y-110">
                <CountUp
                  start={prevPackagesRef.current}
                  end={packagesRetrieved}
                  duration={1.5}
                  separator=""
                  useEasing={true}
                  preserveValue={true}
                />
              </p>
            </div>

            <div className="text-center py-4 px-2">
              <div className="text-gray-400 text-lg uppercase tracking-wider py-2">
                AWAITING
                <div className="h-2"></div>   
                PICKUP
              </div>
              <p className="text-8xl text-end mt-6 text-white seven-segment transform scale-y-110">
                <CountUp
                  start={prevAwaitingRef.current}
                  end={awaitingPickup}
                  duration={1.5}
                  separator=""
                  useEasing={true}
                  preserveValue={true}
                />
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
