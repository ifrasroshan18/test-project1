# Azure M365 Cost Analytics Application

This is a Next.js web application for exporting and viewing Azure M365 cost analytics reports. It allows users to import Excel files or pull cost data directly from Azure Cost Management API, and displays detailed reports with graphical visualizations.

## Features

- **Entra ID Authentication**: Secure login using Microsoft Entra ID (Azure AD)
- **Excel Import**: Upload and parse Azure cost Excel files for graphical viewing
- **Azure API Integration**: Fetch real-time cost and usage data from Azure Cost Management
- **Data Visualization**: Interactive charts and tables for cost analysis
- **Responsive Design**: Built with Tailwind CSS for a modern UI

## Prerequisites

- Node.js 18+
- Azure subscription with M365 services
- Azure AD app registration with appropriate permissions

## Setup

1. **Clone the repository** (if applicable) and install dependencies:
   ```bash
   npm install
   ```

2. **Azure AD Configuration**:
   - Create an app registration in Azure AD
   - Add redirect URI: `http://localhost:3000/api/auth/callback/azure-ad`
   - Grant API permissions for `Cost Management` (e.g., `CostManagement.Read.All`)
   - Note the Client ID, Client Secret, and Tenant ID

3. **Environment Variables**:
   Create a `.env.local` file in the root directory:
   ```
   AZURE_AD_CLIENT_ID=your-client-id
   AZURE_AD_CLIENT_SECRET=your-client-secret
   AZURE_AD_TENANT_ID=your-tenant-id
   NEXTAUTH_SECRET=your-random-secret-here
   ```

4. **Run the development server**:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) and sign in with your Entra ID.

## Usage

- **Import Excel**: Drag and drop an Azure cost Excel file to view its data graphically
- **Fetch from Azure**: Enter the scope (e.g., subscription ID) and click "Fetch Cost Data" to pull live data
- **View Reports**: See cost trends in tables and charts

## API Endpoints

- `GET /api/auth/[...nextauth]` - NextAuth authentication
- `GET /api/cost?scope=<azure-scope>` - Fetch cost data from Azure

## Technologies Used

- Next.js 16 (App Router)
- NextAuth.js for authentication
- Azure SDK for Cost Management
- XLSX for Excel parsing
- Recharts for data visualization
- Tailwind CSS for styling
- TypeScript

## Deployment

This app can be deployed to Vercel, Netlify, or any Node.js hosting platform. Ensure environment variables are set in the deployment environment.

## Contributing

Feel free to submit issues and pull requests.

## License

MIT
