import { Outlet, useNavigate } from "react-router"
import { useEffect } from "react"
import { useAuthUser } from "../contexts/AuthContext"
import DashboardTabs from "../components/UserDashboard/DashboardTabs"
import Loader from "../components/Loader"

const UserDashboard = () => {
    const { authenticated, ready } = useAuthUser()
    const navigate = useNavigate()

    useEffect(() => {
        if (ready && !authenticated) {
            navigate("/")
        }
    }, [ready, authenticated, navigate])

    if (!ready) {
        return <Loader />
    }

    if (!authenticated) {
        return <Loader />
    }

    return (
        <div className="min-h-screen">
            <div className="bg-[#2B2B2B] bg-full-size absolute inset-0 w-full h-full -z-10"></div>

            <div className='bg-[#2B2B2B] px-3 sm:px-4 xl:px-0 relative'>
                <p className="text-center xl:max-w-5xl max-w-2xl mt-6 sm:mt-10 mx-auto py-2 sm:py-3 rounded-t-xl bg-[#E5EE00] text-[#181818] sequel-75 uppercase text-sm sm:text-lg xl:text-xl">User Dashboard</p>
                <DashboardTabs />
            </div>
            {/* Content For Each Tab */}
            <div className="max-w-7xl mx-auto my-4 sm:my-6 p-3 sm:p-4 lg:p-6 relative">
                <Outlet />
            </div>
        </div>
    )
}

export default UserDashboard