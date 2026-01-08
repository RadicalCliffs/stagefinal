const Heading = ({ text, classes }: { text: string; classes?: string }) => {
  return (
    <h1
      className={`md:text-3xl sm:text-2xl text-xl sequel-95 uppercase text-center ${classes}`}
    >
      {text}
    </h1>
  );
};

export default Heading;
