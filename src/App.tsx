import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { FamilyProvider } from "@/contexts/FamilyContext";
import { ProtectedRoute, PublicAuthRoute, SetupFamilyRoute } from "@/components/auth/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import LoginPage from "./pages/Login.tsx";
import RegisterPage from "./pages/Register.tsx";
import SetupFamilyPage from "./pages/SetupFamily.tsx";
import DashboardPage from "./pages/Dashboard.tsx";
import TransactionsPage from "./pages/Transactions.tsx";
import CardsPage from "./pages/Cards.tsx";
import CardInvoiceDetailPage from "./pages/CardInvoiceDetail.tsx";
import InvestmentsPage from "./pages/Investments.tsx";
import DebtsPage from "./pages/Debts.tsx";
import DebtDetailPage from "./pages/DebtDetail.tsx";
import SchedulePage from "./pages/Schedule.tsx";
import ReportsPage from "./pages/Reports.tsx";
import GoalsPage from "./pages/Goals.tsx";
import ImportCsvPage from "./pages/ImportCsv.tsx";
import FamilyPage from "./pages/Family.tsx";
import SettingsPage from "./pages/Settings.tsx";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route
              path="/login"
              element={
                <PublicAuthRoute>
                  <LoginPage />
                </PublicAuthRoute>
              }
            />
            <Route
              path="/register"
              element={
                <PublicAuthRoute>
                  <RegisterPage />
                </PublicAuthRoute>
              }
            />
            <Route
              path="/setup-family"
              element={
                <SetupFamilyRoute>
                  <FamilyProvider>
                    <SetupFamilyPage />
                  </FamilyProvider>
                </SetupFamilyRoute>
              }
            />
            <Route
              element={
                <ProtectedRoute>
                  <FamilyProvider>
                    <AppLayout />
                  </FamilyProvider>
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/transactions" element={<TransactionsPage />} />
              <Route path="/cards" element={<CardsPage />} />
              <Route path="/cards/:id" element={<CardInvoiceDetailPage />} />
              <Route path="/investments" element={<InvestmentsPage />} />
              <Route path="/debts" element={<DebtsPage />} />
              <Route path="/debts/:id" element={<DebtDetailPage />} />
              <Route path="/schedule" element={<SchedulePage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/goals" element={<GoalsPage />} />
              <Route path="/import" element={<ImportCsvPage />} />
              <Route path="/family" element={<FamilyPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
