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
        <div>
            <div className="bg-[#2B2B2B] bg-full-size absolute inset-0 w-full h-full"></div>

            <div className='bg-[#2B2B2B] xl:px-0 px-4 relative max-[400px]:px-3'>
                <p className="text-center xl:max-w-5xl max-w-2xl mt-10 mx-auto py-3 rounded-t-xl bg-[#E5EE00] text-[#181818] sequel-75 uppercase xl:text-xl sm:text-lg">User Dashboard</p>
                <DashboardTabs />
            </div>
            {/* Content For Each Tab */}
            <div className="max-w-7xl mx-auto my-6 lg:p-6 p-4 relative">
                <Outlet />
            </div>
        </div>
    )
}

export default UserDashboard