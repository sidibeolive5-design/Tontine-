import { Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import Home from "@/pages/Home";
import { Login, Register, Forgot } from "@/pages/Auth";
import { AvailableTontines, TontineDetail, InfoPage } from "@/pages/Public";
import MemberSpace from "@/pages/MemberSpace";
import InvitationPage from "@/pages/Invitation";
import StaffSpace from "@/pages/StaffSpace";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/tontines-disponibles" element={<AvailableTontines />} />
        <Route path="/details-tontine" element={<TontineDetail />} />
        <Route path="/comment-ca-marche" element={<InfoPage slug="comment-ca-marche" />} />
        <Route path="/regles" element={<InfoPage slug="regles" />} />
        <Route path="/a-propos" element={<InfoPage slug="a-propos" />} />
        <Route path="/conditions-utilisation" element={<InfoPage slug="conditions-utilisation" />} />
        <Route path="/politique-confidentialite" element={<InfoPage slug="politique-confidentialite" />} />
        <Route path="/connexion" element={<Login />} />
        <Route path="/creer-mon-compte" element={<Register />} />
        <Route path="/mot-de-passe-oublie" element={<Forgot />} />
        <Route path="/invitation" element={<InvitationPage />} />
        <Route path="/espace-membre" element={<MemberSpace />} />
        <Route path="/gerance" element={<StaffSpace mode="manager" />} />
        <Route path="/administration" element={<StaffSpace mode="admin" />} />
        <Route path="*" element={<InfoPage slug="a-propos" />} />
      </Routes>
      {/* Bottom-center on purpose: a top-right toast covers the mobile menu button. */}
      <Toaster position="bottom-center" offset="5.5rem" richColors />
    </>
  );
}
