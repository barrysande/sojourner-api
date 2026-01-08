import type { Server } from 'socket.io'
import type { ExtendedSocket } from '../../types/socket.js'
import ChatService from './chat_service.js'
import app from '@adonisjs/core/services/app'
import SocketHttpContextMiddleware from '#middleware/socket/socket_http_context_middleware'
import logger from '@adonisjs/core/services/logger'

const userConnections = new Map<number, Set<string>>()
const typingUsers = new Map<number, Set<number>>()
const typingTimeouts = new Map<string, NodeJS.Timeout>()

export function setupWebsocketsHandlers(io: Server) {
  io.use(SocketHttpContextMiddleware)

  io.on('connection', async (socket: ExtendedSocket) => {
    // 1. REGISTER LISTENERS IMMEDIATELY
    socket.on('join_room', async (data: { shareGroupId: number }, callback?) => {
      // Security: Check auth status via socket.data.user
      const user = socket.data.user

      if (!user) {
        socket.emit('error', { message: 'Authentication pending. Please try again.' })
        if (callback) callback({ success: false, error: 'Auth pending' })
        return
      }

      try {
        const chatService = await app.container.make(ChatService)
        const hasAccess = await chatService.validateChatAccess(user.id, data.shareGroupId)

        if (!hasAccess) {
          socket.emit('error', { message: 'Access denied to this chat room' })
          if (callback) callback({ success: false, error: 'Access denied' })
          return
        }

        const chatRoom = await chatService.createOrFindChatRoom(data.shareGroupId)
        const roomName = `room_${chatRoom.id}`
        await socket.join(roomName)

        const history = await chatService.getChatHistory(chatRoom.id, 1, 30)

        // Return data to the specific user
        socket.emit('room_joined', {
          roomId: chatRoom.id,
          shareGroupId: data.shareGroupId,
          roomName: chatRoom.roomName || chatRoom.shareGroup?.name,
          chatHistory: history.messages,
          meta: history.meta,
        })

        // Notify others in the room
        socket.to(roomName).emit('user_joined', {
          user: {
            id: user.id,
            fullName: user.fullName,
          },
        })

        // Acknowledge success
        if (callback) callback({ success: true, roomId: chatRoom.id })
      } catch (error) {
        logger.error({ err: error }, 'Join room error')
        socket.emit('error', { message: 'Failed to join chat room' })
        if (callback) callback({ success: false, error: 'Failed to join chat room' })
      }
    })

    socket.on('send_message', async (data: { roomId: number; message: string }, callback?) => {
      const user = socket.data.user
      if (!user) return

      try {
        if (!data.message?.trim()) {
          socket.emit('error', { message: 'Message cannot be empty' })
          if (callback) callback({ success: false, error: 'Message cannot be empty' })
          return
        }

        const chatService = await app.container.make(ChatService)
        const chatMessage = await chatService.saveMessage(data.roomId, user.id, data.message)

        await chatMessage.load('user')

        const roomName = `room_${data.roomId}`

        io.to(roomName).emit('new_message', chatMessage.toJSON())

        // --- Typing Logic Cleanup ---
        const typingKey = `${data.roomId}_${user.id}`
        if (typingTimeouts.has(typingKey)) {
          clearTimeout(typingTimeouts.get(typingKey)!)
          typingTimeouts.delete(typingKey)
        }

        const typing = typingUsers.get(data.roomId)
        if (typing && typing.has(user.id)) {
          typing.delete(user.id)
          io.to(roomName).emit('typing_users', {
            users: Array.from(typing),
          })

          if (typing.size === 0) {
            typingUsers.delete(data.roomId)
          }
        }
        // -----------------------------

        // Acknowledge success
        if (callback) callback({ success: true, messageId: chatMessage.id })
      } catch (error) {
        logger.error({ err: error }, 'Send message error')
        socket.emit('error', { message: 'Failed to send message' })
        if (callback) callback({ success: false, error: 'Failed to send message' })
      }
    })

    socket.on('typing_start', async (data: { roomId: number }) => {
      const user = socket.data.user
      if (!user) return

      const typingKey = `${data.roomId}_${user.id}`

      if (typingTimeouts.has(typingKey)) {
        clearTimeout(typingTimeouts.get(typingKey)!)
      }

      const timeout = setTimeout(() => {
        const typing = typingUsers.get(data.roomId)
        if (typing) {
          typing.delete(user.id)
          io.to(`room_${data.roomId}`).emit('typing_users', {
            users: Array.from(typing),
          })

          if (typing.size === 0) {
            typingUsers.delete(data.roomId)
          }
        }

        typingTimeouts.delete(typingKey)
      }, 5000)

      typingTimeouts.set(typingKey, timeout)

      if (!typingUsers.has(data.roomId)) {
        typingUsers.set(data.roomId, new Set())
      }

      typingUsers.get(data.roomId)!.add(user.id)

      const roomName = `room_${data.roomId}`
      socket.to(roomName).emit('typing_users', {
        users: Array.from(typingUsers.get(data.roomId)!),
      })
    })

    socket.on('typing_stop', async (data: { roomId: number }) => {
      const user = socket.data.user
      if (!user) return

      const typingKey = `${data.roomId}_${user.id}`

      if (typingTimeouts.has(typingKey)) {
        clearTimeout(typingTimeouts.get(typingKey)!)
        typingTimeouts.delete(typingKey)
      }

      const typing = typingUsers.get(data.roomId)
      if (!typing) return

      typing.delete(user.id)

      const roomName = `room_${data.roomId}`
      socket.to(roomName).emit('typing_users', {
        users: Array.from(typing),
      })

      if (typing.size === 0) {
        typingUsers.delete(data.roomId)
      }
    })

    socket.on('disconnect', () => {
      const user = socket.data.user
      if (!user) return // If auth failed, user is undefined, nothing to clean up

      logger.info(`User ${user.fullName} (ID: ${user.id}) disconnected`)

      const connections = userConnections.get(user.id)
      if (connections) {
        connections.delete(socket.id)
        if (connections.size === 0) {
          userConnections.delete(user.id)
        }
      }

      typingUsers.forEach((typing, roomId) => {
        if (typing.has(user.id)) {
          typing.delete(user.id)

          const typingKey = `${roomId}_${user.id}`
          const timeout = typingTimeouts.get(typingKey)
          if (timeout) {
            clearTimeout(timeout)
            typingTimeouts.delete(typingKey)
          }

          const roomName = `room_${roomId}`
          io.to(roomName).emit('typing_users', {
            users: Array.from(typing),
          })

          if (typing.size === 0) {
            typingUsers.delete(roomId)
          }
        }
      })
    })

    // ==================================================================
    // 2. PERFORM AUTHENTICATION (Async)
    // ==================================================================
    try {
      await socket.context.auth.authenticateUsing(['web'])

      const user = socket.context.auth.user

      if (!user) {
        socket.disconnect(true)
        return
      }

      // Success! Hydrate socket.data.user so listeners can proceed
      socket.data.user = user
      logger.info(`User ${user.fullName} (ID: ${user.id}) connected via Socket`)

      // --- CRITICAL: Notify Client they are ready ---
      socket.emit('authenticated', { userId: user.id })

      if (!userConnections.has(user.id)) {
        userConnections.set(user.id, new Set())
      }
      userConnections.get(user.id)!.add(socket.id)
    } catch (error) {
      // Auth failed (invalid session, etc)
      socket.disconnect(true)
    }
  })
}

/**
 * Used to kick out a user from chat group.
 * @param io Server
 * @param userId
 * @param shareGroupId
 * @returns
 */
export async function disconnectUserFromGroup(io: Server, userId: number, shareGroupId: number) {
  const chatService = await app.container.make(ChatService)
  const chatRoom = await chatService.getChatRoomByGroupId(shareGroupId)

  if (!chatRoom) {
    return
  }

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

    const typingKey = `${chatRoom.id}_${userId}`
    if (typingTimeouts.has(typingKey)) {
      clearTimeout(typingTimeouts.get(typingKey)!)
      typingTimeouts.delete(typingKey)
    }

    io.to(roomName).emit('typing_users', {
      users: Array.from(typing),
    })

    if (typing.size === 0) {
      typingUsers.delete(chatRoom.id)
    }
  }
}
