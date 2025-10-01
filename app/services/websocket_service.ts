import type { Server, Socket } from 'socket.io'
import { ChatService } from './chat_service.js'
import { WebsocketTokenService } from './websocket_token_service.js'
import User from '#models/user'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'

interface AuthenticatedSocket extends Socket {
  userId?: number
  user?: User
}

const userConnections = new Map<number, Set<string>>()

const typingUsers = new Map<number, Set<number>>()

export function setupWebSocketHandlers(io: Server) {
  // Authentication middleware for socket.io
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token
      if (!token) {
        return next(new Error('AUthentication token required.'))
      }

      const tokenService = await app.container.make(WebsocketTokenService)
      const decoded = await tokenService.verifyToken(token)
      if (!decoded) {
        return next(new Error('Invalid token'))
      }

      const user = await User.find(decoded.userId)
      if (!user) {
        return next(new Error('User not found'))
      }

      socket.userId = user.id
      socket.user = user
      next()
    } catch (error) {
      next(new Error('Authentication failed'))
    }
  })

  io.on('connection', (socket: AuthenticatedSocket) => {
    logger.info(`User ${socket.user?.fullName} connected`)

    // Track users' connections to allow multiple tabs.
    if (!userConnections.has(socket.userId!)) {
      userConnections.set(socket.userId!, new Set())
    }

    userConnections.get(socket.userId!)!.add(socket.id)

    // join handler
    socket.on('join_room', async (data: { shareGroupId: number }) => {
      try {
        const chatService = await app.container.make(ChatService)

        const hasAccess = await chatService.validateChatAccess(socket.userId!, data.shareGroupId)
        if (!hasAccess) {
          socket.emit('error', { message: 'Access denied to this chat room' })
          return
        }

        // Get or create chat room
        const chatRoom = await chatService.createOrFindChatRoom(data.shareGroupId)

        // join a room
        const roomName = `room_${chatRoom.id}`
        await socket.join(roomName)

        // get chat history
        const history = await chatService.getChatHistory(chatRoom.id, 1, 30)

        // send room data and history
        socket.emit('room_joined', {
          roomId: chatRoom.id,
          shareGroupId: data.shareGroupId,
          roomName: chatRoom.roomName || chatRoom.shareGroup?.name,
          chatHistory: history.messages,
          pagination: history.pagination,
        })

        // tell others - system chat
        socket.to(roomName).emit('user_joined', {
          user: {
            id: socket.user!.id,
            fullName: socket.user!.fullName,
          },
        })
      } catch (error) {
        logger.error('Join room error:', error)
        socket.emit('error', { message: 'Failed to join chat room' })
      }
    })

    // send message to handler
    socket.on('send_message', async (data: { roomId: number; message: string }) => {
      try {
        if (!data.message?.trim()) {
          socket.emit('error', { message: 'Message cannot be empty' })
          return
        }

        const chatService = await app.container.make(ChatService)

        // save message to db
        const chatMessage = await chatService.saveMessage(
          data.roomId,
          socket.userId!,
          data.message.trim()
        )

        // preload the user
        await chatMessage.load('user')

        // broadcast to all
        const roomName = `room_${data.roomId}`
        io.to(roomName).emit('new_message', chatMessage.toJSON())

        // clear typing state for sender
        const typing = typingUsers.get(data.roomId)
        if (typing && typing.has(socket.userId!)) {
          typing.delete(socket.userId!)
          socket.to(roomName).emit('typing_users', {
            users: Array.from(typing),
          })
        }
      } catch (error) {
        logger.error('Send message error:', error)
        socket.emit('error', { message: error.message || 'Failed to send message' })
      }
    })

    // typing states event handlers
    socket.on('typing_start', async (data: { roomId: number }) => {
      if (!typingUsers.has(data.roomId)) {
        typingUsers.set(data.roomId, new Set())
      }

      typingUsers.get(data.roomId)!.add(socket.userId!)
      const roomName = `room_${data.roomId}`
      socket.to(roomName).emit('typing_users', {
        users: Array.from(typingUsers.get(data.roomId)!),
      })
    })

    socket.on('typing_stop', async (data: { roomId: number }) => {
      const typing = typingUsers.get(data.roomId)
      if (typing) {
        typing.delete(socket.userId!)

        const roomName = `room_${data.roomId}`
        socket.to(roomName).emit('typing_users', {
          users: Array.from(typing),
        })

        if (typing.size === 0) {
          typingUsers.delete(data.roomId)
        }
      }
    })

    // disconnection
    socket.on('disconnect', () => {
      logger.info(`User ${socket.user?.fullName} disconnected`)

      // remove from connections
      const connections = userConnections.get(socket.userId!)
      if (connections) {
        connections.delete(socket.id)
        if (connections.size === 0) {
          userConnections.delete(socket.userId!)
        }
      }

      // Clean up typing indicators
      for (const [roomId, typing] of typingUsers.entries()) {
        if (typing.has(socket.userId!)) {
          typing.delete(socket.userId!)

          const roomName = `room_${roomId}`
          socket.to(roomName).emit('typing_users', {
            users: Array.from(typing),
          })

          if (typing.size === 0) {
            typingUsers.delete(roomId)
          }
        }
      }
    })
  })
}

// group creator power to remove user from chat
export async function disconnectUserFromGroup(io: Server, userId: number, shareGroupId: number) {
  const chatService = await app.container.make(ChatService)
  const chatRoom = await chatService.getChatRoomByGroupId(shareGroupId)
  if (!chatRoom) return

  const roomName = `room_${chatRoom.id}`
  const userSocketIds = userConnections.get(userId)

  if (userSocketIds) {
    for (const socketId of userSocketIds) {
      const socket = io.sockets.sockets.get(socketId)
      if (socket) {
        socket.leave(roomName)
        socket.emit('kicked_from_room', {
          message: 'You have been removed from this group',
          shareGroupId,
        })
      }
    }
  }
  const typing = typingUsers.get(chatRoom.id)
  if (typing && typing.has(userId)) {
    typing.delete(userId)
    io.to(roomName).emit('typing_users', {
      users: Array.from(typing),
    })
  }
}
