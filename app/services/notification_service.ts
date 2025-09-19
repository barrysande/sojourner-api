import User from '#models/user'
import Notification from '#models/notification'
import ShareGroup from '#models/share_group'
import { DateTime } from 'luxon'
import HiddenGem from '#models/hidden_gem'
import ShareGroupMember from '#models/share_group_member'

export default class NotificationService {
  async createShareGroupInviteNotification(
    userId: number,
    shareGroupId: number,
    inviterId: number
  ): Promise<Notification> {
    const inviter = await User.findOrFail(inviterId)

    const shareGroup = await ShareGroup.findOrFail(shareGroupId)

    return await Notification.create({
      userId: userId,
      type: 'share_group_invite',
      title: 'Share Group Invitation',
      message: `${inviter.fullName} invited you to join '${shareGroup.name}' share group`,
      data: {
        shareGroupId: shareGroupId,
        inviterId: inviterId,
        inviteCode: shareGroup.inviteCode,
        groupName: shareGroup.name,
        inviterName: inviter.fullName,
      },
      isRead: false,
      sentAt: DateTime.now(),
    })
  }

  async createGemSharedNotifications(
    memberIds: number[],
    shareGroupId: number,
    sharedBy: number,
    gemIds: number[]
  ): Promise<Notification[]> {
    const sharer = await User.findOrFail(sharedBy)
    const shareGroup = await ShareGroup.findOrFail(shareGroupId)
    const gems = await HiddenGem.query().whereIn('id', gemIds).select('id', 'name')

    const gemNames = gems.map((gem) => gem.name)
    const gemCount = gems.length
    const message =
      gemCount === 1
        ? `${sharer.fullName} shared "${gemNames[0]}" with ${shareGroup.name}`
        : `${sharer.fullName} shared ${gemCount} gems with ${shareGroup.name}`

    const notificationData = memberIds.map((memberId) => ({
      userId: memberId,
      type: 'gem_shared' as const,
      title: 'New Gems Shared',
      message,
      data: {
        shareGroupId,
        sharedBy,
        gemIds,
        gemNames,
        groupName: shareGroup.name,
        sharerName: sharer.fullName,
      },
      isRead: false,
      sentAt: DateTime.now(),
    }))

    return await Notification.createMany(notificationData)
  }

  async createGroupJoinedNotification(
    shareGroupId: number,
    newUserId: number
  ): Promise<Notification[]> {
    const newUser = await User.findOrFail(newUserId)
    const shareGroup = await ShareGroup.findOrFail(shareGroupId)

    const existingMembers = await ShareGroupMember.query()
      .where('share_group_id', shareGroupId)
      .where('status', 'active')
      .where('user_id', '!=', newUserId)

    const notificationData = existingMembers.map((member) => ({
      userId: member.userId,
      type: 'group_joined' as const,
      title: 'New Group Member',
      message: `${newUser.fullName} joined ${shareGroup.name}`,
      data: {
        shareGroupId: shareGroupId,
        newUserId: newUserId,
        groupName: shareGroup.name,
        newUserName: newUser.fullName,
      },
      isRead: false,
      sentAt: DateTime.now(),
    }))
    return await Notification.createMany(notificationData)
  }

  async createGroupLeftNotification(
    shareGroupId: number,
    leftUserId: number
  ): Promise<Notification[]> {
    const shareGroup = await ShareGroup.findOrFail(shareGroupId)
    const leftUser = await User.findOrFail(leftUserId)

    const existingMembers = await ShareGroupMember.query()
      .where('share_group_id', shareGroupId)
      .where('status', 'active')
      .where('user_id', '!=', leftUserId)

    const notificationData = existingMembers.map((member) => ({
      userId: member.userId,
      type: 'group_left' as const,
      title: 'Member Left Group',
      message: `${leftUser.fullName} left ${shareGroup.name}`,
      data: {
        shareGroupId: shareGroupId,
        leftUserId: leftUserId,
        groupName: shareGroup.name,
        leftUserName: leftUser.fullName,
      },
      isRead: false,
      sentAt: DateTime.now(),
    }))
    return await Notification.createMany(notificationData)
  }

  async createGroupDissolvedNotification(
    shareGroupId: number,
    dissolvedBy: number
  ): Promise<Notification[]> {
    const dissolver = await User.findOrFail(dissolvedBy)
    const shareGroup = await ShareGroup.findOrFail(shareGroupId)

    const allMembers = await ShareGroupMember.query()
      .where('share_group_id', shareGroupId)
      .where('status', 'active')
      .where('user_id', '!=', dissolvedBy)

    const notificationData = allMembers.map((member) => ({
      userId: member.userId,
      type: 'group_dissolved' as const,
      title: 'Share Group Dissolved',
      message: `${dissolver.fullName} dissolved the ${shareGroup.name} share group`,
      data: {
        shareGroupId: shareGroupId,
        dissolvedBy: dissolvedBy,
        groupName: shareGroup.name,
        dissolverName: dissolver.fullName,
      },
      isRead: false,
      sentAt: DateTime.now(),
    }))

    return await Notification.createMany(notificationData)
  }

  async getUserNotifications(
    userId: number,
    limit: number = 20,
    offset: number = 0
  ): Promise<Notification[]> {
    return await Notification.query()
      .where('user_id', userId)
      .orderBy('sent_at', 'desc')
      .limit(limit)
      .offset(offset)
  }

  async markNotificationAsRead(notificationId: number): Promise<Notification> {
    const notification = await Notification.findOrFail(notificationId)
    notification.isRead = true
    await notification.save()
    return notification
  }

  async markAllNotificationsAsRead(userId: number): Promise<number> {
    const updated = await Notification.query()
      .where('user_id', userId)
      .where('is_read', false)
      .update({ is_read: true })
    return updated.length
  }

  async getUnreadNotificationCount(userId: number): Promise<number> {
    const unreadCount = await Notification.query()
      .where('user_id', userId)
      .where('is_read', false)
      .count('* as total')

    return Number(unreadCount[0].$extras.total)
  }

  async deleteNotification(notificationId: number): Promise<boolean> {
    const notification = await Notification.findOrFail(notificationId)

    await notification.delete()
    return true
  }
}
