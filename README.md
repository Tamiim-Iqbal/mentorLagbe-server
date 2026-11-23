# MentorLagbe — Server

The backend REST API for **MentorLagbe**, a tuition and mentorship platform connecting students with tutors across Bangladesh.

This server handles tuition listings, student applications, user management, authentication verification, PRO membership payments, and administrative operations.

## 🌐 Project Links

- **Live Website:** https://web-mentor-lagbe.vercel.app/
- **Client Repository:** https://github.com/Tamiim-Iqbal/mentorLagbe-client
- **Server Repository:** https://github.com/Tamiim-Iqbal/mentorLagbe-server

## ✨ Features

### 🔐 Authentication & Authorization
- JWT-based authentication verification.
- Public key verification using JSON Web Key Sets (JWKS).
- Protected API routes.
- Role-based administrator authorization.

### 📚 Tuition Management
- Retrieve approved and active tuition listings.
- Get the latest tuition opportunities.
- View individual tuition details.
- Create and manage tuition listings.
- Track tuition approval status.
- Enforce free-plan tuition posting limits.

### 👨‍🎓 Student Operations
- Browse tuition opportunities.
- Submit tuition applications.
- Manage saved tuition listings.
- Access application-related information.

### 👨‍🏫 Mentor Operations
- Create tuition listings.
- Retrieve personal tuition listings.
- View and manage applicants.
- Check tuition posting limits.

### 🛡️ Admin Operations
- Manage registered users.
- Retrieve and manage tuition listings.
- Approve, reject, and update tuition approval statuses.
- Access transaction information.

### 💳 Payment Integration
- Stripe Checkout integration.
- Verify completed payments.
- Activate PRO membership after successful payment verification.
- Store transaction records.
- Prevent duplicate payment processing with a unique session ID index.

## 🛠️ Technology Stack

| Category | Technologies |
|---|---|
| Runtime | Node.js |
| Framework | Express 5 |
| Language | JavaScript (ES Modules) |
| Database | MongoDB |
| Authentication | JWT, JOSE, JWKS |
| Payment Gateway | Stripe |
| Middleware | CORS |
| Environment Configuration | dotenv |
| Deployment | Vercel |

## 🗄️ Database Collections

The application uses MongoDB with the `mentorlagbe` database.

| Collection | Purpose |
|---|---|
| `user` | User accounts and membership information |
| `tuitions` | Tuition listings |
| `applications` | Student tuition applications |
| `savedTuitions` | Bookmarked tuition listings |
| `transactions` | Payment and transaction records |

## 🚀 Getting Started

### Prerequisites

Make sure you have installed:

- Node.js (LTS recommended)
- npm
- MongoDB database
- Stripe account and API credentials

### 1. Clone the Repository

```bash
git clone https://github.com/Tamiim-Iqbal/mentorLagbe-server.git
```

### 2. Navigate to the Project

```bash
cd mentorLagbe-server
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the project root.

```env
PORT=8000

MONGODB_URI=your_mongodb_connection_string

STRIPE_SECRET_KEY=your_stripe_secret_key

AUTH_URL=http://localhost:3000
```

**Environment variable details:**

| Variable | Description |
|---|---|
| `PORT` | Server port (defaults to `8000`) |
| `MONGODB_URI` | MongoDB connection string |
| `STRIPE_SECRET_KEY` | Stripe secret API key |
| `AUTH_URL` | Base URL of the Better Auth application used for JWKS verification |

For production, set `AUTH_URL` to the deployed client URL:

```env
AUTH_URL=https://web-mentor-lagbe.vercel.app
```

Never commit `.env` files or expose private API keys.

### 5. Run the Server

```bash
node index.js
```

The server will start on the configured port.

For local development, the default port is:

```text
http://localhost:8000
```

## 🔒 Security

- Protected endpoints require a valid Bearer token.
- JWT tokens are verified using the authentication server's JWKS endpoint.
- Administrative endpoints require administrator authorization.
- CORS is configured for the production client and local development.
- Stripe payment sessions are verified on the server before membership activation.

## 🔗 API Overview

Some of the primary API endpoints include:

| Method | Endpoint | Description |
|---|---|---|
| GET | `/tuitions` | Retrieve approved and active tuitions |
| GET | `/tuitions/latest` | Retrieve latest tuition listings |
| GET | `/tuitions/:id` | Retrieve tuition details |
| GET | `/tuitions/limit` | Check mentor posting limits |
| POST | `/tuitions` | Create a tuition listing |
| GET | `/my-tuitions` | Retrieve mentor's tuition listings |
| GET | `/applicants` | Retrieve mentor's applicants |
| POST | `/payments` | Verify a Stripe payment |
| GET | `/users` | Retrieve users (admin only) |
| GET | `/admin/transactions` | Retrieve transactions (admin only) |

Protected endpoints require a valid authentication token. Additional endpoints are available in `index.js`.

## 🌍 Deployment

The backend is deployed separately from the Next.js client.

For production deployment:

1. Configure the MongoDB connection string.
2. Add the Stripe secret key.
3. Set `AUTH_URL` to the deployed client URL.
4. Configure the required environment variables in the hosting platform.
5. Ensure the client domain is allowed by the server's CORS configuration.

## 🔗 Related Project

**Frontend Repository:**  
https://github.com/Tamiim-Iqbal/mentorLagbe-client

**Live Application:**  
https://web-mentor-lagbe.vercel.app/

## 👨‍💻 Developer

**Tamim Iqbal**

- GitHub: [@Tamiim-Iqbal](https://github.com/Tamiim-Iqbal)

---

<p align="center">
  Backend API for MentorLagbe.
</p>