import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 35000,
  headers: {
    'Content-Type': 'application/json'
  }
});

export const apiService = {
  async getMetrics() {
    try {
      const response = await api.get('/metrics');
      return response.data;
    } catch (error) {
      console.error('Error fetching metrics:', error);
      return {
        packagesRetrieved: 0,
        awaitingPickup: 0,
        averageResponseTime: 'N/A'
      };
    }
  },

  async sendChatMessage(message: string) {
    try {
      const response = await api.post('/chat', {
        message: message
      }, {
        timeout: 300000
      });
      
      console.log('Chat response:', response.data.content);
      
      if (response.data?.content) {
        return response.data.content;
      } else {
        return 'Sorry, I received an unexpected response format.';
      }
    } catch (error: any) {
      console.error('Chat error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      
      if (error.code === 'ECONNABORTED') {
        throw new Error('The request took too long to respond. Please try again.');
      }
      
      throw error;
    }
  },

  async updateDeliveryMetrics(routeId: string, completionTime: number) {
    try {
      const response = await api.post('/delivery-complete', {
        routeId,
        completionTime
      });
      return response.data;
    } catch (error) {
      console.error('Error updating delivery metrics:', error);
      throw error;
    }
  },

  async getNewRoute() {
    try {
      const response = await api.get('/new-route');
      return response.data;
    } catch (error) {
      console.error('Error fetching new route:', error);
      throw error;
    }
  },

  async getRouteCoordinates(routeId: string) {
    try {
      const response = await api.get(`/route/${routeId}/coordinates`);
      return response.data;
    } catch (error) {
      console.error('Error fetching route coordinates:', error);
      throw error;
    }
  }
};


