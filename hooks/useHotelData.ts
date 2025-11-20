import { useState, useEffect, useCallback } from 'react';
import { apiService, Hotel, Room, Activity, PowerReading, Settings } from '@/lib/api';
import { socketService } from '@/lib/socket';

const CONNECTION_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_CONNECTION_TIMEOUT_MS || 60000);

const enhanceRoom = (room: Room): Room => {
  const lastHeartbeatTimestamp = room.lastHeartbeat ? new Date(room.lastHeartbeat).getTime() : null;
  const isOnline = !!(lastHeartbeatTimestamp && (Date.now() - lastHeartbeatTimestamp) <= CONNECTION_TIMEOUT_MS);

  return {
    ...room,
    lastHeartbeat: room.lastHeartbeat || null,
    connectionStatus: room.connectionStatus || (isOnline ? 'online' : 'offline'),
    isOnline,
  };
};

export function useHotelData(hotelId: string) {
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [powerReadings, setPowerReadings] = useState<PowerReading[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHotelData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [hotelData, roomsData, activitiesData, powerData, settingsData] = await Promise.all([
        apiService.getHotel(hotelId),
        apiService.getRooms(hotelId),
        apiService.getActivity(hotelId),
        apiService.getPower(hotelId),
        apiService.getSettings(hotelId),
      ]);

      setHotel(hotelData);
      setRooms(roomsData.map(enhanceRoom));
      setActivities(activitiesData);
      setPowerReadings(powerData);
      setSettings(settingsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch hotel data');
      console.error('Error fetching hotel data:', err);
    } finally {
      setLoading(false);
    }
  }, [hotelId]);

  useEffect(() => {
    fetchHotelData();
  }, [fetchHotelData]);

  // Set up real-time updates
  useEffect(() => {
    if (!hotelId) return;

    // Connect to socket
    socketService.connect();

    // Listen for room updates
    const handleRoomUpdate = (data: any) => {
      setRooms(prevRooms => {
        const updatedRooms = [...prevRooms];
        const roomNumber = (data.roomNum || data.number || '').toString();
        const roomIndex = updatedRooms.findIndex(room => room.number === roomNumber);
        const lastHeartbeat = data.lastHeartbeat || new Date().toISOString();

        if (roomIndex !== -1) {
          updatedRooms[roomIndex] = enhanceRoom({
            ...updatedRooms[roomIndex],
            ...data,
            number: roomNumber || updatedRooms[roomIndex].number,
            lastHeartbeat,
          });
        } else if (roomNumber) {
          updatedRooms.push(
            enhanceRoom({
              hotelId,
              id: Number(roomNumber) || Date.now(),
              number: roomNumber,
              status: data.status || 'vacant',
              hasMasterKey: data.hasMasterKey || false,
              hasLowPower: data.hasLowPower || false,
              powerStatus: data.powerStatus || 'off',
              occupantType: data.occupantType || null,
              lastHeartbeat,
              connectionStatus: data.connectionStatus,
            })
          );
        }
        
        // Update hotel occupancy stats
        setHotel(prevHotel => {
          if (!prevHotel) return prevHotel;
          
          const activeRooms = updatedRooms.filter(room => 
            room.status === 'occupied' || room.status === 'maintenance'
          ).length;
          
          const occupancy = prevHotel.totalRooms 
            ? Math.round((activeRooms / prevHotel.totalRooms) * 100) 
            : 0;

          return {
            ...prevHotel,
            activeRooms,
            occupancy,
          };
        });
        
        return updatedRooms;
      });
    };

    // Listen for activity updates
    const handleActivityUpdate = (data: Activity) => {
      setActivities(prevActivities => [data, ...prevActivities]);
    };

    socketService.onRoomUpdate(hotelId, handleRoomUpdate);
    socketService.onActivityUpdate(hotelId, handleActivityUpdate);

    return () => {
      socketService.offRoomUpdate(hotelId, handleRoomUpdate);
      socketService.offActivityUpdate(hotelId, handleActivityUpdate);
    };
  }, [hotelId]);

  useEffect(() => {
    const interval = setInterval(() => {
      setRooms(prevRooms => prevRooms.map(enhanceRoom));
    }, CONNECTION_TIMEOUT_MS);

    return () => clearInterval(interval);
  }, []);

  const updateHotel = useCallback(async (data: Partial<Hotel>) => {
    try {
      await apiService.updateHotel(hotelId, data);
      setHotel(prevHotel => prevHotel ? { ...prevHotel, ...data } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update hotel');
      throw err;
    }
  }, [hotelId]);

  const refreshData = useCallback(() => {
    fetchHotelData();
  }, [fetchHotelData]);

  const updateSettings = useCallback(async (data: Partial<Settings>) => {
    const updated = await apiService.updateSettings(hotelId, data);
    setSettings(updated);
  }, [hotelId]);

  return {
    hotel,
    rooms,
    activities,
    powerReadings,
    settings,
    loading,
    error,
    updateHotel,
    refreshData,
    updateSettings,
  };
}

export function useHotelsData() {
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHotels = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const hotelsData = await apiService.getHotels();
      setHotels(hotelsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch hotels');
      console.error('Error fetching hotels:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHotels();
  }, [fetchHotels]);

  const refreshHotels = useCallback(() => {
    fetchHotels();
  }, [fetchHotels]);

  return {
    hotels,
    loading,
    error,
    refreshHotels,
  };
}