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
    console.log(`User ${user.fullName} (ID: ${user.id}) connected`)

    if (!userConnections.has(user.id)) {
      userConnections.set(user.id, new Set())
    }

    userConnections.get(user.id)!.add(socket.id)

    socket.on('join_room', async (data: { shareGroupId: number }) => {
      try {
        // 1.check access permission and emit error if not permitted 2. find or create chat room. 3. load chat history 4. emit system message to said join group
        const chatService = await app.container.make(ChatService)

        const hasAccess = chatService.validateChatAccess(user.id, data.shareGroupId)

        if (!hasAccess) {
          socket.emit('error', { message: 'Access denied to this chat room' })
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
      } catch (error) {
        logger.error('Join room error:', error)
        socket.emit('error', { message: 'Failed to join chat room' })
      }
    })

    socket.on('send_message', async (data: { roomId: number; message: string }) => {
      try {
        // 1. check if message is empty 2. save chat message contents 3. load user's chat message 4. send message to group 5. clear typing indicator
        if (!data.message?.trim()) {
          socket.emit('error', { message: 'Message cannot be empty' })
        }

        const chatService = await app.container.make(ChatService)
        const chatMessage = await chatService.saveMessage(data.roomId, user.id, data.message)

        await chatMessage.load('user')

        const roomName = `room_${data.roomId}`
        socket.to(roomName).emit('new_message', chatMessage.toJSON())

        const typingKey = `${data.roomId}_${user.id}`
        if (typingTimeouts.has(typingKey)) {
          clearTimeout(typingTimeouts.get(typingKey)!)
          typingTimeouts.delete(typingKey)
        }
      } catch (error) {
        logger.error('Send message error:', error)
        socket.emit('error', { message: 'Failed to send message' })
      }
    })

    socket.on('typing_start', async (data: { roomId: number }) => {
      const typingKey = `${data.roomId}_${user.id}`

      if (typingTimeouts.has(typingKey)) {
        clearTimeout(typingTimeouts.get(typingKey))
      }

      const timeout = setTimeout(() => {
        const typing = typingUsers.get(data.roomId)
        if (typing) {
          typing.delete(user.id)
          io.to(`room_${data.roomId}`).emit('typing_users', {
            users: Array.from(typing),
          })
        }

        typingTimeouts.delete(typingKey)
      }, 5000)

      typingTimeouts.set(typingKey, timeout)

      if (!typingUsers.has(data.roomId)) {
        typingUsers.set(data.roomId, new Set())
      }

      typingUsers.get(data.roomId)!.add(user.id)
    })
  })
}
