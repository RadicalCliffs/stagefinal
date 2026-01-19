import Heading from '../../Heading';
import { useState, useEffect } from 'react';
import { database } from '../../../lib/database';
import EntriesCard from '../Entries/EntriesCard';
import Loader from '../../Loader';

export default function Promo() {
    const [promoCompetitions, setPromoCompetitions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchPromoCompetitions = async () => {
            setLoading(true);
            const competitions = await database.getCompetitionsV2('active', 20);
            const promoData = competitions.filter((comp: any) => comp.is_featured).slice(0, 6);
            setPromoCompetitions(promoData);
            setLoading(false);
        };
        fetchPromoCompetitions();
    }, []);

    if (loading) {
        return (
            <div className="py-20">
                <Loader />
            </div>
        );
    }

    return (
        <div>
            <Heading text='PROMOTIONAL COMPETITIONS' classes='text-white sequel-95' />
            <p className='sequel-45 text-white text-center mt-6 sm:leading-relaxed leading-loose sm:w-10/12 mx-auto sm:text-base text-sm'>If you have been lucky enough to receive one of our <span className='sequel-75'>PROMOTIONAL CODES</span> for one of our competitions please enter it into the box to redeem your free entries. Good luck!</p>
            <div className='bg-[#151515] lg:py-14 xl:px-18 px-3 sm:px-4 py-6 sm:py-8 rounded-lg my-8 w-full'>
                <div className="grid lg:grid-cols-2 gap-6  lg:max-h-max max-h-[600px] overflow-auto custom-scrollbar lg:pr-0 pr-2.5">
                    {promoCompetitions.length > 0 ? (
                        promoCompetitions.map((comp) => (
                            <div key={comp.id}>
                                <EntriesCard
                                    variant="compact"
                                    showButton={false}
                                    showCountDown={false}
                                    title={comp.title}
                                    description={comp.description}
                                    isPromoCard
                                />
                            </div>
                        ))
                    ) : (
                        <div className="col-span-2 text-center py-12">
                            <p className="text-white/70 sequel-45 text-lg">
                                No promotional competitions available at this time.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
