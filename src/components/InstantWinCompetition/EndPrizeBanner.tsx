import { useState, useEffect } from 'react';
import { useParams } from 'react-router';
import Countdown from '../Countdown'
import { tokenLogo } from '../../assets/images'
import { database } from '../../lib/database';
import { canEnterCompetition } from '../../constants/competition-status';

const EndPrizeBanner = () => {
    const { id } = useParams<{ id: string }>();
    const [endDate, setEndDate] = useState<string | undefined>(undefined);
    const [isEnded, setIsEnded] = useState(false);

    useEffect(() => {
        const fetchCompetition = async () => {
            if (!id) return;
            const comp = await database.getCompetitionById(id);
            if (comp && comp.is_instant_win) {
                setEndDate(comp.draw_date ?? undefined);
                // Check if competition has ended (sold out, completed, or not accepting entries)
                const totalTickets = Number(comp.total_tickets ?? 0);
                const ticketsSold = Number(comp.tickets_sold ?? 0);
                const isSoldOut = totalTickets > 0 && ticketsSold >= totalTickets;
                const isNotAcceptingEntries = !canEnterCompetition(comp.status);
                setIsEnded(isSoldOut || isNotAcceptingEntries);
            }
        };
        fetchCompetition();
    }, [id]);

    return (
        <div className='max-w-6xl mx-auto'>
            <div className=' bg-[#EF008F] rounded-2xl py-8 text-center overflow-hidden custom-box-shadow relative'>
                <img src={tokenLogo} alt="token" className='absolute left-1/2 -translate-x-1/2 -top-40 opacity-40' />
                <div className='relative'>
                    <h1 className='sequel-95 uppercase md:text-4xl text-2xl lg:px-0 px-4 text-white '>$50k end prize!</h1>
                <div className='bg-white lg:w-6/12 md:w-9/12 w-11/12 mx-auto my-4 h-[3px]'></div>
                <p className='sequel-45 text-white px-4'>Every ticket for this instant win enters you into the <span className='sequel-75 uppercase'>END PRIZE</span> draw.</p>
                <div className='flex sm:flex-row flex-col items-center justify-center gap-8'>
                    <div className='text-white sm:order-none order-2'>
                        <p className='sequel-45 text-xl'>Auto-draw</p>
                        <p className='sequel-45 text-xs'>via chainlink VRF</p>
                    </div>
                    <div className="flex flex-col items-center justify-center mt-5 xl:pb-0 md:pb-8">
                        <p className="sequel-95 uppercase text-white mb-2 sm:text-xl text-2xl">
                            Time Remaining!
                        </p>
                        <Countdown endDate={endDate} isEnded={isEnded} />
                    </div>
                </div>
                </div>
            </div>
            <p className='sequel-45 text-center text-white mt-6 sm:text-lg'>Draw takes place regardless of tickets sold.</p>
        </div>
    )
}

export default EndPrizeBanner