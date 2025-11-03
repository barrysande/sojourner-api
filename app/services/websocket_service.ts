import type { Server } from 'socket.io'
import type { ExtendedSocket } from '../../types/socket.js'
import { ChatService } from './chat_service.js'
import app from '@adonisjs/core/services/app'
import SocketHttpContextMiddleware from '#middleware/socket/socket_http_context_middleware'
import SocketAuthMiddleware from '#middleware/socket/socket_auth_middleware'
import logger from '@adonisjs/core/services/logger'

const userConnections = new Map<number, Set<string>>()
const typingUsers = new Map<number, Set<number>>()
const typingTimeouts = new Map<string, NodeJS.Timeout>()

export function setupWebsocketsHandlers(io: Server) {
  io.use(SocketHttpContextMiddleware)
  io.use(SocketAuthMiddleware({ guards: ['web'] }))

  io.on('connection', (socket: ExtendedSocket) => {
    const user = socket.context.auth.getUserOrFail()
    logger.info(`User ${user.fullName} (ID: ${user.id}) connected`)

    if (!userConnections.has(user.id)) {
      userConnections.set(user.id, new Set())
    }

    userConnections.get(user.id)!.add(socket.id)

    socket.on('join_room', async (data: { shareGroupId: number }, callback?) => {
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

        socket.emit('room_joined', {
          roomId: chatRoom.id,
          shareGroupId: data.shareGroupId,
          roomName: chatRoom.roomName || chatRoom.shareGroup?.name,
          chatHistory: history.messages,
          meta: history.meta,
        })

        socket.to(roomName).emit('user_joined', {
          user: {
            id: user.id,
            fullName: user.fullName,
          },
        })

        // Acknowledge success
        if (callback) callback({ success: true, roomId: chatRoom.id })
      } catch (error) {
        logger.error('Join room error:', error)
        socket.emit('error', { message: 'Failed to join chat room' })
        if (callback) callback({ success: false, error: 'Failed to join chat room' })
      }
    })

    socket.on('send_message', async (data: { roomId: number; message: string }, callback?) => {
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

        const typingKey = `${data.roomId}_${user.id}`
        if (typingTimeouts.has(typingKey)) {
          clearTimeout(typingTimeouts.get(typingKey)!)
          typingTimeouts.delete(typingKey)
        }

        // Remove user from typing users and notify others
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

        // Acknowledge success
        if (callback) callback({ success: true, messageId: chatMessage.id })
      } catch (error) {
        logger.error('Send message error:', error)
        socket.emit('error', { message: 'Failed to send message' })
        if (callback) callback({ success: false, error: 'Failed to send message' })
      }
    })

    socket.on('typing_start', async (data: { roomId: number }) => {
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
