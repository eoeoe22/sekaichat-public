# Project Overview

This project is a web-based, multi-character chatbot application powered by Google Gemini. It's built on a serverless architecture using Cloudflare Workers, D1 for the database, and R2 for file storage. The application features a general-purpose AI chatbot and a dating simulation game.

## Key Technologies

*   **Backend:** Cloudflare Workers (JavaScript)
*   **Frontend:** HTML, CSS, JavaScript
*   **Database:** Cloudflare D1 (SQLite compatible)
*   **File Storage:** Cloudflare R2
*   **AI:** Google Gemini

## Architecture

The application follows a modular structure, with the main entry point at `src/index.js`. This file acts as a router, directing incoming requests to the appropriate handlers for API endpoints and static pages. The backend logic is organized into several modules within the `src` directory, each responsible for a specific feature (e.g., authentication, chat, dating simulation). The frontend is served from the `public` directory.

# Building and Running

This project is set up for automatic deployment. Any changes pushed to the `main` branch of the GitHub repository will be automatically deployed to Cloudflare Workers.

For local development, you can use the `wrangler` CLI, the official command-line tool for Cloudflare Workers.

**TODO:** Add specific commands for local development and testing.

# Development Conventions

*   The backend is written in JavaScript (ES modules).
*   The code is organized into modules based on functionality.
*   The project uses a Cloudflare D1 database, so SQL queries should be compatible with SQLite.
*   The `wrangler.toml` file contains configuration for the Cloudflare Workers environment, including database bindings, R2 bucket bindings, and environment variables.

# Database Schema

The database is split into two main schemas: one for the core chat application and one for the dating simulation.

## Core Schema (`schema.sql`)

*   `users`: Stores user information, including credentials and Discord integration details.
*   `characters`: Stores information about the official chat characters.
*   `user_characters`: Stores information about user-created characters.
*   `conversations`: Stores metadata for each chat conversation.
*   `messages`: Stores the individual messages within each conversation.
*   `files`: Stores metadata for uploaded files.
*   `knowledge_base`: Stores information for the AI's knowledge base.
*   `notices`: Stores site-wide notices.

## Dating Sim Schema (`dating_schema.sql`)

*   `dating_characters`: Stores information about the characters available in the dating sim.
*   `user_character_affection`: Tracks user-specific affection levels and memories for each dating sim character.
*   `dating_conversations`: Stores metadata for dating sim conversations.
*   `dating_messages`: Stores the messages within each dating sim conversation.
*   `dating_checkpoints`: Allows for saving and loading the state of a dating sim conversation.
*   `dating_random_events`: Logs random events that occur during the dating sim.
