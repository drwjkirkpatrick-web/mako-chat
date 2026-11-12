# MAKO CHAT — Product Specification

> Source of truth, captured verbatim from the project brief (Walker, 2026-11-12).
> Scope changes and new decisions are recorded in `docs/PLAN.md` and
> `Project_state.md`; this file stays as originally written.

---

## MAKO CHAT – Private Institutional Communication Platform

### Project Overview

MAKO CHAT is a private, secure, cross-platform messaging application designed to facilitate communication within institutions, schools, training centres and organizations.

The platform will provide an environment where registered members can communicate through private one-to-one conversations and group chats, share files, exchange information and receive real-time notifications.

Unlike conventional messaging platforms that depend on third-party commercial services, MAKO CHAT will be self-hosted on an institution-controlled server, giving the institution greater control over its communication infrastructure, user accounts and data.

### 1. How It Will Work

MAKO CHAT will operate through a central messaging server installed on a dedicated computer within the institution.

Users will install the MAKO CHAT desktop application on their computers and connect to this central server.

The platform will support:

- Communication between computers connected to the same local network (LAN).
- Communication between users connected through different networks and geographical locations.
- Access through both Windows computers and macOS devices.
- Centralized management of users, conversations and shared resources.

Remote connectivity will be facilitated through a secure private networking solution, allowing authorized users to communicate even when they are outside the institution.

### 2. Core Features

**User Management**
- Administrator-controlled account creation.
- Individual usernames and passwords.
- User profiles and profile pictures.
- Account activation, suspension and management.
- Online and offline presence indicators.

**Messaging**
- Private one-to-one conversations.
- Group chats with multiple participants.
- Real-time message delivery.
- Message history.
- Read receipts and typing indicators.
- Message notifications.

**File Sharing**
- Sharing documents, PDFs, images and other files.
- Downloading shared resources.
- Group-based resource sharing.

**Group Management**
- Creating and managing communication groups.
- Adding and removing participants.
- Group administrators and permissions.
- Institutional announcements and broadcasts.

**Administration**
- Centralized administrator dashboard.
- User account management.
- Group management.
- Access control and security settings.
- Storage management and backups.

### 3. Platform Compatibility and Installation

MAKO CHAT will be developed as a fully branded desktop application with its own identity, interface and institutional branding.

It will support:

- Windows: A standalone .exe installer that can be distributed through a USB flash drive and installed by users without technical expertise.
- macOS: A compatible .dmg installer for Mac computers.

The installation process should be straightforward: copy the installer, run it, install the application and log in using administrator-issued credentials.

### 4. Technology and Infrastructure

The proposed technical architecture includes:

- Matrix Synapse: Open-source messaging server.
- PostgreSQL: Central database.
- Electron and React: Cross-platform desktop application and user interface.
- Tailscale: Secure connectivity between devices on different networks.
- Ubuntu Linux: Server operating system.
- Docker: Application deployment and service management.

The platform will be self-hosted, with the institution retaining control over its server infrastructure and data.

It will not require the institution to purchase a conventional commercial email domain for user registration. Internal usernames and a dedicated server identity will be used.

### 5. Long-Term Vision

MAKO CHAT is intended to become more than a basic messaging application.

Future development may introduce:

- Voice and video calls.
- Screen sharing.
- Desktop-to-desktop communication tools.
- Video and audio conferencing.
- Advanced administrative controls.
- Multiple institutional departments and communication spaces.
- Mobile applications.
- Integration with other institutional management systems.

### 6. Project Objective

The ultimate objective is to establish an affordable, customizable and institution-controlled communication platform that enables people to collaborate efficiently, regardless of their device or network location.

MAKO CHAT will combine the convenience of modern messaging applications with the privacy, flexibility and administrative control of a self-hosted communication system.

---

- Product Name: MAKO CHAT
- Product Category: Private Institutional Messaging and Communication Platform
- Deployment Model: Self-hosted
- Supported Desktop Platforms: Windows and macOS
- Connectivity: Local network and remote access
- User Access: Administrator-managed accounts
